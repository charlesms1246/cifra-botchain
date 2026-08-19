// Package signing reproduces, exactly, the signature scheme CifraAttestationNFT verifies.
//
// The contract does:
//
//	resultHash = keccak256(abi.encodePacked(
//	    keccak256(resultData), actionId, keccak256(bytes(submissionTag)), status))
//	payload    = keccak256(abi.encode(SCORE_RESULT_DOMAIN, chainId, resultHash))
//	signer     = ecrecover(toEthSignedMessageHash(payload), signature)
//
// and requires signer == scorerAddress. Every helper here mirrors one of those lines. If any
// of it drifts from the Solidity, attest() reverts with BadScorerSignature — so the round-trip
// is covered by tests that assert against known-good vectors.
package signing

import (
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// Result is the scored output, in the exact field order the contract decodes.
type Result struct {
	InvoiceID       [32]byte
	Grade           string // "A".."D" — placed like Solidity's bytes32("A"): left-aligned
	RiskScoreBps    uint32
	DiscountRateBps uint32
	ModelVersion    string   // left-aligned in a bytes32, e.g. "cifra-score-v1"
	ImageDigest     [32]byte // sha256 of the container image; zero = unpinned build
}

// EncodeResult ABI-encodes the six static words the contract's abi.decode expects:
// (bytes32 invoiceId, bytes32 grade, uint256 riskScoreBps, uint256 discountRateBps,
//
//	bytes32 modelVersion, bytes32 imageDigest)
//
// All six are 32-byte static types, so the encoding is a plain concatenation — no head/tail
// offsets to get wrong.
func EncodeResult(r Result) []byte {
	buf := make([]byte, 0, 192)
	buf = append(buf, r.InvoiceID[:]...)
	buf = append(buf, bytes32FromString(r.Grade)...)
	buf = append(buf, uint256Word(uint64(r.RiskScoreBps))...)
	buf = append(buf, uint256Word(uint64(r.DiscountRateBps))...)
	buf = append(buf, bytes32FromString(r.ModelVersion)...)
	buf = append(buf, r.ImageDigest[:]...)
	return buf
}

// ResultHash mirrors the contract's abi.encodePacked hash over the action envelope.
func ResultHash(resultData []byte, actionID [32]byte, submissionTag string, status uint8) [32]byte {
	packed := make([]byte, 0, 32+32+32+1)
	packed = append(packed, crypto.Keccak256(resultData)...)
	packed = append(packed, actionID[:]...)
	packed = append(packed, crypto.Keccak256([]byte(submissionTag))...)
	packed = append(packed, status)
	return [32]byte(crypto.Keccak256(packed))
}

// Payload mirrors keccak256(abi.encode(domain, chainId, resultHash)) — three static words, so
// again a plain concatenation.
func Payload(domain string, chainID int64, resultHash [32]byte) [32]byte {
	buf := make([]byte, 0, 96)
	buf = append(buf, bytes32FromString(domain)...)
	buf = append(buf, leftPad32(big.NewInt(chainID).Bytes())...)
	buf = append(buf, resultHash[:]...)
	return [32]byte(crypto.Keccak256(buf))
}

// SignEIP191 signs the EIP-191 ("\x19Ethereum Signed Message:\n32" prefixed) hash of payload
// and returns a 65-byte [r||s||v] signature with v in {27,28}, which is what OpenZeppelin's
// ECDSA.recover expects.
func SignEIP191(keyHex string, payload [32]byte) ([]byte, error) {
	key, err := crypto.HexToECDSA(keyHex)
	if err != nil {
		return nil, fmt.Errorf("parsing signing key: %w", err)
	}
	sig, err := crypto.Sign(accountsTextHash(payload[:]), key)
	if err != nil {
		return nil, fmt.Errorf("signing: %w", err)
	}
	// go-ethereum returns v as 0/1; Solidity wants 27/28.
	sig[64] += 27
	return sig, nil
}

// RecoverEIP191 is SignEIP191's inverse — used to verify a data source's signature over a
// provenance commitment.
func RecoverEIP191(digest []byte, sig []byte) (common.Address, error) {
	if len(sig) != 65 {
		return common.Address{}, fmt.Errorf("signature must be 65 bytes, got %d", len(sig))
	}
	normalized := make([]byte, 65)
	copy(normalized, sig)
	if normalized[64] >= 27 {
		normalized[64] -= 27
	}
	pub, err := crypto.SigToPub(accountsTextHash(digest), normalized)
	if err != nil {
		return common.Address{}, fmt.Errorf("recovering signer: %w", err)
	}
	return crypto.PubkeyToAddress(*pub), nil
}

// AddressFromKey returns the address the given private key signs as — what must be registered
// on-chain as CifraAttestationNFT.scorerAddress().
func AddressFromKey(keyHex string) (common.Address, error) {
	key, err := crypto.HexToECDSA(keyHex)
	if err != nil {
		return common.Address{}, err
	}
	return crypto.PubkeyToAddress(key.PublicKey), nil
}

// accountsTextHash is EIP-191 personal_sign: keccak256("\x19Ethereum Signed Message:\n" + len + msg).
func accountsTextHash(data []byte) []byte {
	msg := fmt.Sprintf("\x19Ethereum Signed Message:\n%d%s", len(data), data)
	return crypto.Keccak256([]byte(msg))
}

// bytes32FromString mirrors Solidity's bytes32("abc"): left-aligned, right zero-padded.
// Strings longer than 32 bytes are truncated, matching the Solidity literal's behaviour.
func bytes32FromString(s string) []byte {
	out := make([]byte, 32)
	copy(out, s)
	return out
}

func uint256Word(v uint64) []byte { return leftPad32(new(big.Int).SetUint64(v).Bytes()) }

func leftPad32(b []byte) []byte {
	if len(b) >= 32 {
		return b[len(b)-32:]
	}
	out := make([]byte, 32)
	copy(out[32-len(b):], b)
	return out
}
