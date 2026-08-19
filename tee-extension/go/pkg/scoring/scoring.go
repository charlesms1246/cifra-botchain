// Package scoring implements Cifra's v1 invoice risk model.
//
// The model is deliberately transparent (a published, weighted formula — not a
// black box): only the *inputs* are private, the *logic* is auditable. See
// Cifra's CLAUDE.md "Scoring model, v1".
//
//	risk = 0.4*repayment_history + 0.3*relationship_size + 0.2*tenor + 0.1*jurisdiction
//	grade = A (>=80) | B (>=60) | C (>=40) | D (<40)
//	discount_rate = base_rate + grade_spread[grade]
//
// All arithmetic is integer/fixed-point in basis points (0..10000 = 0.00%..100.00%)
// so the result is exactly reproducible — no floating point in the enclave.
package scoring

import (
	"errors"
	"fmt"
)

// bpsFull is 100.00% expressed in basis points. Every sub-score is in [0, bpsFull].
const bpsFull = 10000

// maxTenorDays caps the tenor axis: an invoice due in >= maxTenorDays scores 0 on
// tenor (longest-dated = riskiest); due today scores bpsFull.
const maxTenorDays = 120

// Model weights, scaled to integers that sum to 10 (0.4/0.3/0.2/0.1).
const (
	weightRepayment    = 4
	weightRelationship = 3
	weightTenor        = 2
	weightJurisdiction = 1
	weightTotal        = weightRepayment + weightRelationship + weightTenor + weightJurisdiction
)

// baseRateBps is the discount-rate floor applied to every grade; grade spreads add to it.
const baseRateBps = 400

// gradeSpreadBps is the additional discount rate charged per grade (worse grade = wider spread).
var gradeSpreadBps = map[string]uint32{
	"A": 200,
	"B": 400,
	"C": 700,
	"D": 1200,
}

// jurisdictionScoreBps is a static, synthetic table for the demo (v1). Higher =
// lower risk. Unknown jurisdictions get jurisdictionDefaultBps.
var jurisdictionScoreBps = map[string]uint32{
	"US": 9000, "GB": 9000, "DE": 8500, "FR": 8500, "SG": 8500,
	"JP": 8500, "CH": 9000, "NL": 8500, "AE": 7000, "IN": 6500,
	"BR": 6000, "ZA": 5500, "NG": 4000, "AR": 4000,
}

const jurisdictionDefaultBps = 5000

// Input is the buyer's payment-history data scored inside the enclave. In
// production this arrives ECIES-encrypted and is decrypted by the TEE node; for
// v1 it is synthetic. Amounts are unitless but must share the same unit.
type Input struct {
	// InvoiceID binds this scoring request to a specific on-chain invoice (0x-prefixed
	// 32-byte hex). It is NOT a scoring factor — the model ignores it — but the enclave
	// echoes it into the signed result so CifraAttestationNFT can verify the grade was
	// produced for exactly this invoice (audit finding H1). Committed by the caller inside
	// the encrypted payload; the enclave cannot be tricked into re-binding a grade.
	InvoiceID string `json:"invoiceId"`

	// Repayment history with this buyer.
	InvoicesPaidOnTime uint32 `json:"invoicesPaidOnTime"`
	InvoicesTotal      uint32 `json:"invoicesTotal"`

	// Relationship size: this invoice's face value vs. the historical average
	// invoice volume with this buyer. A larger-than-usual invoice is riskier.
	InvoiceAmount       uint64 `json:"invoiceAmount"`
	HistoricalAvgVolume uint64 `json:"historicalAvgVolume"`

	// Tenor: days until the invoice is due. Shorter = lower risk.
	TenorDays uint32 `json:"tenorDays"`

	// Jurisdiction: ISO-3166 alpha-2 code of the buyer. In v1 this is looked up in a static
	// table; in v2 the caller supplies JurisdictionScoreBps read from the on-chain
	// CifraJurisdictionOracle (FDC Web2Json), and that value is used instead.
	JurisdictionCode string `json:"jurisdictionCode"`

	// JurisdictionScoreBps (v2, Stage A): jurisdiction sub-score in bps sourced from the
	// on-chain Web2Json jurisdiction oracle (higher = lower risk). When > 0 it OVERRIDES the
	// static table, so the jurisdiction term of the score provably traces to a real,
	// on-chain-verified Web2Json attestation rather than a synthetic table. 0 = use the table.
	JurisdictionScoreBps uint32 `json:"jurisdictionScoreBps,omitempty"`

	// Provenance of the private inputs (v2, Stage B). When ProvenanceCommitment is set, the
	// enclave recomputes keccak256(ProvenanceCanonical(in) ‖ salt) and REFUSES TO SIGN unless
	// it equals the commitment — which was itself attested on-chain via FDC Web2Json over the
	// source accounting API. So funders can verify the grade was computed on data that provably
	// came from the real source, without the data ever being disclosed. Empty = v1 synthetic.
	ProvenanceCommitment string `json:"provenanceCommitment,omitempty"` // 0x-prefixed 32-byte hex
	ProvenanceSalt       string `json:"provenanceSalt,omitempty"`       // 0x-prefixed hex (kept private; blocks brute-force)
}

// ProvenanceCanonical is the deterministic serialization of the PRIVATE buyer inputs that the
// provenance commitment covers. The source accounting API and the enclave must agree on it
// exactly (same lesson as the on-chain invoice commitment): fixed field order, pipe-delimited.
// keccak256(ProvenanceCanonical(in) ‖ salt) == the on-chain Web2Json-attested commitment.
func ProvenanceCanonical(in Input) string {
	return fmt.Sprintf("%d|%d|%d|%d", in.InvoicesPaidOnTime, in.InvoicesTotal, in.InvoiceAmount, in.HistoricalAvgVolume)
}

// Result is the scored output. Only this leaves the enclave (signed by the TEE
// identity) — never the Input.
type Result struct {
	Grade           string `json:"grade"`           // "A" | "B" | "C" | "D"
	RiskScoreBps    uint32 `json:"riskScoreBps"`    // 0..10000 (weighted risk score, 82.34% = 8234)
	DiscountRateBps uint32 `json:"discountRateBps"` // base rate + grade spread

	// Sub-scores, surfaced for transparency/audit (each 0..10000).
	RepaymentScoreBps    uint32 `json:"repaymentScoreBps"`
	RelationshipScoreBps uint32 `json:"relationshipScoreBps"`
	TenorScoreBps        uint32 `json:"tenorScoreBps"`
	JurisdictionScoreBps uint32 `json:"jurisdictionScoreBps"`
}

// ErrInvalidInput is returned (wrapped) when the Input cannot be scored.
var ErrInvalidInput = errors.New("invalid scoring input")

// Score applies Cifra's v1 model to input and returns the grade, risk score, and
// discount rate. It is pure and deterministic.
func Score(in Input) (Result, error) {
	if in.InvoicesTotal == 0 {
		return Result{}, fmt.Errorf("%w: invoicesTotal must be > 0", ErrInvalidInput)
	}
	if in.InvoicesPaidOnTime > in.InvoicesTotal {
		return Result{}, fmt.Errorf("%w: invoicesPaidOnTime (%d) exceeds invoicesTotal (%d)",
			ErrInvalidInput, in.InvoicesPaidOnTime, in.InvoicesTotal)
	}
	if in.InvoiceAmount == 0 {
		return Result{}, fmt.Errorf("%w: invoiceAmount must be > 0", ErrInvalidInput)
	}
	if in.HistoricalAvgVolume == 0 {
		return Result{}, fmt.Errorf("%w: historicalAvgVolume must be > 0", ErrInvalidInput)
	}

	repayment := repaymentScore(in.InvoicesPaidOnTime, in.InvoicesTotal)
	relationship := relationshipScore(in.InvoiceAmount, in.HistoricalAvgVolume)
	tenor := tenorScore(in.TenorDays)
	// v2 Stage A: prefer the on-chain Web2Json oracle value when supplied; else the v1 table.
	jurisdiction := jurisdictionScore(in.JurisdictionCode)
	if in.JurisdictionScoreBps > 0 {
		jurisdiction = in.JurisdictionScoreBps
		if jurisdiction > bpsFull {
			jurisdiction = bpsFull
		}
	}

	risk := (weightRepayment*repayment +
		weightRelationship*relationship +
		weightTenor*tenor +
		weightJurisdiction*jurisdiction) / weightTotal

	grade := gradeFor(risk)

	return Result{
		Grade:                grade,
		RiskScoreBps:         risk,
		DiscountRateBps:      baseRateBps + gradeSpreadBps[grade],
		RepaymentScoreBps:    repayment,
		RelationshipScoreBps: relationship,
		TenorScoreBps:        tenor,
		JurisdictionScoreBps: jurisdiction,
	}, nil
}

// repaymentScore is the share of past invoices paid on time, in bps.
func repaymentScore(paidOnTime, total uint32) uint32 {
	return uint32(uint64(paidOnTime) * bpsFull / uint64(total))
}

// relationshipScore rewards invoices at or below the historical average volume
// (established, normal-sized) and penalizes outsized ones: bps = min(100%, avg/amount).
func relationshipScore(amount, avg uint64) uint32 {
	score := avg * bpsFull / amount
	if score > bpsFull {
		return bpsFull
	}
	return uint32(score)
}

// tenorScore is linear in tenor: due today = 100%, due at/after maxTenorDays = 0%.
func tenorScore(tenorDays uint32) uint32 {
	if tenorDays >= maxTenorDays {
		return 0
	}
	return bpsFull - tenorDays*bpsFull/maxTenorDays
}

// jurisdictionScore looks up the static table, defaulting for unknown codes.
func jurisdictionScore(code string) uint32 {
	if s, ok := jurisdictionScoreBps[code]; ok {
		return s
	}
	return jurisdictionDefaultBps
}

// gradeFor maps a risk score (bps) to a letter grade. Thresholds are 80/60/40 on
// the 0..100 scale (8000/6000/4000 in bps).
func gradeFor(riskBps uint32) string {
	switch {
	case riskBps >= 8000:
		return "A"
	case riskBps >= 6000:
		return "B"
	case riskBps >= 4000:
		return "C"
	default:
		return "D"
	}
}
