package extension

import (
	"encoding/hex"
	"math/big"
	"strings"
	"testing"

	"sign-extension/pkg/scoring"

	"golang.org/x/crypto/sha3"
)

// TestVerifyProvenance (v2 Stage B): the enclave accepts inputs that hash to the committed
// value and rejects any tampered input or wrong commitment (refuse-to-sign).
func TestVerifyProvenance(t *testing.T) {
	saltHex := strings.Repeat("ab", 16)
	in := scoring.Input{InvoicesPaidOnTime: 88, InvoicesTotal: 100, InvoiceAmount: 120_000, HistoricalAvgVolume: 100_000, ProvenanceSalt: "0x" + saltHex}
	salt, _ := hex.DecodeString(saltHex)
	h := sha3.NewLegacyKeccak256()
	h.Write([]byte(scoring.ProvenanceCanonical(in)))
	h.Write(salt)
	in.ProvenanceCommitment = "0x" + hex.EncodeToString(h.Sum(nil))

	if err := verifyProvenance(in); err != nil {
		t.Errorf("valid provenance rejected: %v", err)
	}
	tampered := in
	tampered.InvoicesPaidOnTime = 99 // change a private input → commitment no longer matches
	if err := verifyProvenance(tampered); err == nil {
		t.Error("tampered input accepted — provenance not enforced")
	}
	wrong := in
	wrong.ProvenanceCommitment = "0x" + strings.Repeat("00", 32)
	if err := verifyProvenance(wrong); err == nil {
		t.Error("wrong commitment accepted")
	}
}

// TestAbiEncodeScore verifies the result encodes exactly like Solidity's
// abi.encode(bytes32 invoiceId, bytes32 grade, uint256 riskScoreBps, uint256 discountRateBps):
// four 32-byte words — invoiceId, grade (left-aligned), integers (right-aligned big-endian).
func TestAbiEncodeScore(t *testing.T) {
	var invoiceID [32]byte
	invoiceID[0] = 0xde
	invoiceID[31] = 0xad
	out := abiEncodeScore(invoiceID, "A", 9900, 600)

	if len(out) != 128 {
		t.Fatalf("len = %d, want 128", len(out))
	}

	// word 0: invoiceId, verbatim (H1 binding).
	for i := 0; i < 32; i++ {
		if out[i] != invoiceID[i] {
			t.Fatalf("invoiceId word mismatch at byte %d", i)
		}
	}

	// word 1: bytes32("A") — 0x41 then zero padding.
	if out[32] != 'A' {
		t.Errorf("grade byte[0] = 0x%02x, want 0x41 ('A')", out[32])
	}
	for i := 33; i < 64; i++ {
		if out[i] != 0 {
			t.Fatalf("grade word not right-zero-padded at byte %d", i)
		}
	}

	// word 2: riskScoreBps, word 3: discountRateBps (right-aligned big-endian).
	if got := new(big.Int).SetBytes(out[64:96]); got.Uint64() != 9900 {
		t.Errorf("riskScoreBps = %s, want 9900", got)
	}
	if got := new(big.Int).SetBytes(out[96:128]); got.Uint64() != 600 {
		t.Errorf("discountRateBps = %s, want 600", got)
	}
}

// TestParseBytes32 covers strict 32-byte hex parsing used for the invoiceId binding.
func TestParseBytes32(t *testing.T) {
	if _, err := parseBytes32("0x" + repeat("ab", 32)); err != nil {
		t.Fatalf("valid 32-byte hex rejected: %v", err)
	}
	for _, bad := range []string{"", "0x", "0x1234", repeat("zz", 32)} {
		if _, err := parseBytes32(bad); err == nil {
			t.Errorf("expected error for %q", bad)
		}
	}
}

func repeat(s string, n int) string {
	out := ""
	for i := 0; i < n; i++ {
		out += s
	}
	return out
}
