package server

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// writeErr returns the reason to the caller. Scoring errors are about the SHAPE of the request
// (missing field, bad hex, out-of-range counts), never about the buyer's data itself, so they
// are safe to surface.
func writeErr(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func parseBytes32(s string) ([32]byte, error) {
	var out [32]byte
	b, err := decodeHex(s)
	if err != nil {
		return out, err
	}
	if len(b) != 32 {
		return out, fmt.Errorf("expected 32 bytes, got %d", len(b))
	}
	copy(out[:], b)
	return out, nil
}

func decodeHex(s string) ([]byte, error) {
	return hex.DecodeString(strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(s), "0x"), "0X"))
}

// decodeHexOrBase64 accepts either encoding for ciphertext: browser clients (eciesjs) naturally
// produce hex, while Go/JSON clients tend to produce base64. Guessing here is cheap and saves a
// class of "it works in curl but not in the app" bug.
func decodeHexOrBase64(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	if b, err := decodeHex(s); err == nil && (strings.HasPrefix(s, "0x") || len(s)%2 == 0 && isHex(s)) {
		return b, nil
	}
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("not valid hex or base64")
	}
	return b, nil
}

func isHex(s string) bool {
	s = strings.TrimPrefix(strings.TrimPrefix(s, "0x"), "0X")
	if s == "" {
		return false
	}
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

// parseDigest accepts "sha256:<64 hex>" (what a registry reports) or bare 32-byte hex.
func parseDigest(s string) ([32]byte, error) {
	return parseBytes32(strings.TrimPrefix(strings.TrimSpace(s), "sha256:"))
}
