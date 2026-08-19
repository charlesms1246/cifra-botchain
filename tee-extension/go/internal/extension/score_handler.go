package extension

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strings"

	"sign-extension/internal/config"
	"sign-extension/pkg/scoring"

	"golang.org/x/crypto/sha3"

	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
)

// processCifra routes CIFRA instructions by OPCommand (currently only SCORE).
func (e *Extension) processCifra(action teetypes.Action, df *instruction.DataFixed) (int, []byte) {
	switch {
	case df.OPCommand == teeutils.ToHash(config.OPCommandScore):
		ar := e.processScore(action, df)
		b, _ := json.Marshal(ar)
		return http.StatusOK, b

	default:
		return http.StatusNotImplemented, []byte(fmt.Sprintf(
			"unsupported op command: received %s, expected %s (%s)",
			df.OPCommand.Hex(), teeutils.ToHash(config.OPCommandScore).Hex(), config.OPCommandScore,
		))
	}
}

// processScore is the Cifra risk-scoring handler. It decrypts the buyer's
// payment-history data inside the enclave, applies the v1 model, and returns a
// signed grade — the raw buyer data never leaves the TEE.
//
// Result.Data is ABI-encoded (bytes32 invoiceId, bytes32 grade, uint256 riskScoreBps,
// uint256 discountRateBps) so a Solidity contract can decode and consume it. The
// invoiceId is echoed from the (encrypted) input so the TEE signature binds the grade
// to a specific invoice (audit finding H1).
func (e *Extension) processScore(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	if len(df.OriginalMessage) == 0 {
		return buildResult(action, df, nil, 0, fmt.Errorf("originalMessage is empty"))
	}

	// 1. DECRYPT — the buyer data is ECIES-encrypted on-chain; the TEE node holds the key.
	plaintext, err := decryptViaNode(e.signPort, df.OriginalMessage)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("decryption failed: %v", err))
	}

	// 2. DECODE — strict: reject unknown fields so malformed input can't be scored silently.
	var in scoring.Input
	dec := json.NewDecoder(bytes.NewReader(plaintext))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("decoding buyer data: %v", err))
	}

	// 2b. PROVENANCE (v2, Stage B) — if the caller supplied a commitment, the private inputs
	//     MUST hash to it (that commitment is attested on-chain via FDC Web2Json over the
	//     source accounting API). Refuse to sign otherwise: the enclave only grades data whose
	//     provenance is verifiable, without ever disclosing the data.
	if in.ProvenanceCommitment != "" {
		if err := verifyProvenance(in); err != nil {
			return buildResult(action, df, nil, 0, err)
		}
	}

	// 3. SCORE — pure, deterministic, integer math (validates its own input).
	res, err := scoring.Score(in)
	if err != nil {
		return buildResult(action, df, nil, 0, err)
	}

	// 4. BIND + ENCODE — echo the caller-committed invoiceId so the TEE signature covers
	//    it (H1), then ABI (bytes32 invoiceId, bytes32 grade, uint256, uint256).
	invoiceID, err := parseBytes32(in.InvoiceID)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("invalid invoiceId: %v", err))
	}
	data := abiEncodeScore(invoiceID, res.Grade, res.RiskScoreBps, res.DiscountRateBps)
	return buildResult(action, df, data, 1, nil)
}

// abiEncodeScore ABI-encodes (bytes32 invoiceId, bytes32 grade, uint256 riskScoreBps,
// uint256 discountRateBps) as four 32-byte words. The grade is a short ASCII string
// placed like Solidity's bytes32("A") (left-aligned, zero-padded right).
func abiEncodeScore(invoiceID [32]byte, grade string, riskScoreBps, discountRateBps uint32) []byte {
	buf := make([]byte, 0, 128)

	buf = append(buf, invoiceID[:]...)

	var gradeWord [32]byte
	copy(gradeWord[:], grade) // left-aligned, right zero-padded
	buf = append(buf, gradeWord[:]...)

	buf = append(buf, padLeft(new(big.Int).SetUint64(uint64(riskScoreBps)).Bytes(), 32)...)
	buf = append(buf, padLeft(new(big.Int).SetUint64(uint64(discountRateBps)).Bytes(), 32)...)

	return buf
}

// verifyProvenance recomputes keccak256(ProvenanceCanonical(in) ‖ salt) and checks it equals the
// caller-supplied commitment. The commitment is what an FDC Web2Json attestation vouched came from
// the source accounting API (public, on-chain); the salt is private (blocks brute-forcing the
// low-entropy history from the public commitment). A match proves the graded data is the attested
// data — without the data ever leaving the enclave.
func verifyProvenance(in scoring.Input) error {
	salt, err := hex.DecodeString(strings.TrimPrefix(strings.TrimPrefix(in.ProvenanceSalt, "0x"), "0X"))
	if err != nil {
		return fmt.Errorf("provenance salt not hex: %v", err)
	}
	h := sha3.NewLegacyKeccak256()
	h.Write([]byte(scoring.ProvenanceCanonical(in)))
	h.Write(salt)
	got := "0x" + hex.EncodeToString(h.Sum(nil))
	if !strings.EqualFold(got, in.ProvenanceCommitment) {
		return fmt.Errorf("provenance mismatch: private inputs do not match the on-chain Web2Json-attested commitment")
	}
	return nil
}

// parseBytes32 strictly parses a 0x-prefixed 32-byte hex string.
func parseBytes32(s string) ([32]byte, error) {
	var out [32]byte
	h := strings.TrimPrefix(strings.TrimPrefix(s, "0x"), "0X")
	if len(h) != 64 {
		return out, fmt.Errorf("expected 32-byte hex (64 chars), got %d", len(h))
	}
	b, err := hex.DecodeString(h)
	if err != nil {
		return out, err
	}
	copy(out[:], b)
	return out, nil
}
