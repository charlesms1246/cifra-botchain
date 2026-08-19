// Package config holds the scoring service's runtime configuration, all of it from the
// environment so the same image runs unchanged locally and on Cloud Run.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

const (
	// ModelVersion identifies the scoring model that produced a grade. It is signed into
	// every result and recorded on-chain, so bumping it is a visible, auditable event —
	// change it whenever the model's arithmetic changes.
	ModelVersion = "cifra-score-v1"

	// ScoreResultDomain must byte-for-byte match SCORE_RESULT_DOMAIN in
	// contracts/CifraAttestationNFT.sol. If these ever drift, every attest() reverts with
	// BadScorerSignature — which is the correct failure, but an opaque one, so treat this
	// constant as part of the contract ABI.
	ScoreResultDomain = "CIFRA_SCORE_RESULT"
)

type Config struct {
	Port int

	// SigningKey signs results. Its address MUST equal CifraAttestationNFT.scorerAddress()
	// on the target chain or the contract rejects every grade.
	SigningKey string

	// EncryptionKey decrypts ECIES request payloads. Deliberately SEPARATE from SigningKey:
	// reusing one key for both signing and decryption is a long-standing footgun, and here it
	// would also mean a leak of the decryption key forges grades. Optional — when unset the
	// service accepts plaintext requests only.
	EncryptionKey string

	// ChainID is bound into the signed payload so a grade signed for one network cannot be
	// replayed on another. Must match the chain the attestation contract is deployed to.
	ChainID int64

	// ImageDigest is the container digest this process is running from, signed into every
	// result. Cloud Run injects the resolved digest; empty means an unpinned local build and
	// is recorded on-chain as zero.
	ImageDigest string

	// TrustedSources are the addresses whose signatures the service will accept over a
	// provenance commitment. Empty disables provenance enforcement entirely (v1 behaviour).
	TrustedSources []string
}

func Load() (Config, error) {
	c := Config{
		Port:          8080, // Cloud Run's default contract
		SigningKey:    strings.TrimPrefix(os.Getenv("SCORER_SIGNING_KEY"), "0x"),
		EncryptionKey: strings.TrimPrefix(os.Getenv("SCORER_ENCRYPTION_KEY"), "0x"),
		ImageDigest:   os.Getenv("IMAGE_DIGEST"),
	}

	if v := os.Getenv("PORT"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return c, fmt.Errorf("PORT %q: %w", v, err)
		}
		c.Port = n
	}

	if c.SigningKey == "" {
		return c, fmt.Errorf("SCORER_SIGNING_KEY is required")
	}

	v := os.Getenv("CHAIN_ID")
	if v == "" {
		return c, fmt.Errorf("CHAIN_ID is required (677 mainnet, 968 testnet)")
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return c, fmt.Errorf("CHAIN_ID %q: %w", v, err)
	}
	c.ChainID = n

	for _, s := range strings.Split(os.Getenv("TRUSTED_SOURCES"), ",") {
		if s = strings.TrimSpace(s); s != "" {
			c.TrustedSources = append(c.TrustedSources, strings.ToLower(s))
		}
	}
	return c, nil
}
