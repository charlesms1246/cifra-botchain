package signing

import (
	"bytes"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/crypto"
)

// A fixed key so the vectors below are stable. Test-only.
const testKey = "4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318"

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(strings.TrimPrefix(s, "0x"))
	if err != nil {
		t.Fatalf("bad hex %q: %v", s, err)
	}
	return b
}

// EncodeResult must produce exactly six 32-byte words in the order the contract's abi.decode
// expects. Get this wrong and attest() reverts with an opaque BadScorerSignature.
func TestEncodeResultLayout(t *testing.T) {
	var invoiceID, digest [32]byte
	copy(invoiceID[:], mustHex(t, "1111111111111111111111111111111111111111111111111111111111111111"))
	copy(digest[:], mustHex(t, "2222222222222222222222222222222222222222222222222222222222222222"))

	got := EncodeResult(Result{
		InvoiceID:       invoiceID,
		Grade:           "A",
		RiskScoreBps:    9900,
		DiscountRateBps: 600,
		ModelVersion:    "cifra-score-v1",
		ImageDigest:     digest,
	})

	if len(got) != 192 {
		t.Fatalf("expected 6 words (192 bytes), got %d", len(got))
	}
	if !bytes.Equal(got[0:32], invoiceID[:]) {
		t.Errorf("word 0 must be invoiceId")
	}
	// bytes32("A") is left-aligned: 0x41 then 31 zero bytes.
	if got[32] != 0x41 {
		t.Errorf("grade must be left-aligned ASCII, got %#x", got[32])
	}
	for _, b := range got[33:64] {
		if b != 0 {
			t.Errorf("grade word must be right zero-padded")
			break
		}
	}
	// uint256 is right-aligned: 9900 = 0x26AC.
	if got[94] != 0x26 || got[95] != 0xAC {
		t.Errorf("riskScoreBps must be right-aligned, got %#x %#x", got[94], got[95])
	}
	if got[126] != 0x02 || got[127] != 0x58 { // 600 = 0x0258
		t.Errorf("discountRateBps must be right-aligned, got %#x %#x", got[126], got[127])
	}
	if !bytes.HasPrefix(got[128:160], []byte("cifra-score-v1")) {
		t.Errorf("modelVersion must be left-aligned")
	}
	if !bytes.Equal(got[160:192], digest[:]) {
		t.Errorf("word 5 must be imageDigest")
	}
}

// A grade signed for one chain must not verify on another — this is the replay guard, and it
// only works if chainId genuinely enters the payload.
func TestPayloadBindsChainID(t *testing.T) {
	var rh [32]byte
	copy(rh[:], mustHex(t, "3333333333333333333333333333333333333333333333333333333333333333"))

	a := Payload("CIFRA_SCORE_RESULT", 968, rh)
	b := Payload("CIFRA_SCORE_RESULT", 677, rh)
	if a == b {
		t.Fatal("payload must differ across chain ids")
	}
	if c := Payload("OTHER_DOMAIN", 968, rh); a == c {
		t.Fatal("payload must differ across domains")
	}
}

// The signature must recover to the signing key's own address — which is what the contract
// compares against scorerAddress().
func TestSignRecoverRoundTrip(t *testing.T) {
	var rh [32]byte
	copy(rh[:], mustHex(t, "4444444444444444444444444444444444444444444444444444444444444444"))
	payload := Payload("CIFRA_SCORE_RESULT", 968, rh)

	sig, err := SignEIP191(testKey, payload)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if len(sig) != 65 {
		t.Fatalf("expected 65-byte signature, got %d", len(sig))
	}
	// Solidity's ECDSA.recover requires v in {27,28}; go-ethereum natively emits {0,1}.
	if sig[64] != 27 && sig[64] != 28 {
		t.Fatalf("v must be 27 or 28, got %d", sig[64])
	}

	want, err := AddressFromKey(testKey)
	if err != nil {
		t.Fatalf("address: %v", err)
	}
	got, err := RecoverEIP191(payload[:], sig)
	if err != nil {
		t.Fatalf("recover: %v", err)
	}
	if got != want {
		t.Fatalf("recovered %s, want %s", got, want)
	}
}

// RecoverEIP191 must accept both v conventions, since data sources signing a provenance
// commitment may emit either.
func TestRecoverAcceptsBothVConventions(t *testing.T) {
	digest := crypto.Keccak256([]byte("commitment"))
	payload := [32]byte(digest)

	sig, err := SignEIP191(testKey, payload)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	want, _ := AddressFromKey(testKey)

	legacy, _ := RecoverEIP191(digest, sig)
	raw := append([]byte(nil), sig...)
	raw[64] -= 27
	normalized, _ := RecoverEIP191(digest, raw)

	if legacy != want || normalized != want {
		t.Fatalf("both v conventions must recover to %s (got %s / %s)", want, legacy, normalized)
	}
}

// ResultHash is order- and content-sensitive across every one of its four inputs.
func TestResultHashSensitivity(t *testing.T) {
	var a1, a2 [32]byte
	copy(a1[:], mustHex(t, "5555555555555555555555555555555555555555555555555555555555555555"))
	copy(a2[:], mustHex(t, "6666666666666666666666666666666666666666666666666666666666666666"))
	data := []byte("result")

	base := ResultHash(data, a1, "threshold", 1)
	for name, got := range map[string][32]byte{
		"different resultData":    ResultHash([]byte("other"), a1, "threshold", 1),
		"different actionId":      ResultHash(data, a2, "threshold", 1),
		"different submissionTag": ResultHash(data, a1, "other", 1),
		"different status":        ResultHash(data, a1, "threshold", 0),
	} {
		if got == base {
			t.Errorf("%s must change the result hash", name)
		}
	}
}

// bytes32("…") truncates rather than overflowing, matching the Solidity literal.
func TestBytes32Truncates(t *testing.T) {
	long := strings.Repeat("x", 40)
	w := bytes32FromString(long)
	if len(w) != 32 {
		t.Fatalf("expected 32 bytes, got %d", len(w))
	}
}
