// Package server is the scoring service's HTTP surface.
//
// WHAT CHANGED FROM THE TEE VERSION, AND WHAT IT MEANS
// On Flare this logic ran inside a Confidential Space enclave, reached through an on-chain
// instruction relayed by data providers. Buyer data was ECIES-encrypted so those relays could
// not read it, and the signing key was bound by hardware attestation to a code hash.
//
// Here the client talks to this service directly over TLS. There is no relay to hide from, and
// the operator of this container can read any request it receives. ECIES is still supported —
// it keeps buyer data out of proxy and request logs, which is worth having — but it is
// defence in depth, NOT a confidentiality guarantee against the operator. Saying otherwise
// would be the exact overclaim this port exists to remove. See claude-docs/DECISIONS.md D1.
package server

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	ecies "github.com/ecies/go/v2"
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/charlesms1246/cifra/scorer/internal/config"
	"github.com/charlesms1246/cifra/scorer/internal/signing"
	"github.com/charlesms1246/cifra/scorer/pkg/scoring"
)

type Server struct {
	cfg         config.Config
	scorerAddr  string
	encryptPub  string
	imageDigest [32]byte
}

func New(cfg config.Config) (*Server, error) {
	addr, err := signing.AddressFromKey(cfg.SigningKey)
	if err != nil {
		return nil, fmt.Errorf("signing key: %w", err)
	}

	s := &Server{cfg: cfg, scorerAddr: addr.Hex()}

	if cfg.EncryptionKey != "" {
		k, err := ecies.NewPrivateKeyFromHex(cfg.EncryptionKey)
		if err != nil {
			return nil, fmt.Errorf("encryption key: %w", err)
		}
		s.encryptPub = k.PublicKey.Hex(true)
	}

	if cfg.ImageDigest != "" {
		d, err := parseDigest(cfg.ImageDigest)
		if err != nil {
			return nil, fmt.Errorf("IMAGE_DIGEST: %w", err)
		}
		s.imageDigest = d
	}
	return s, nil
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("GET /version", s.version)
	mux.HandleFunc("POST /score", s.score)
	return mux
}

// ScorerAddress is the address that must be registered as CifraAttestationNFT.scorerAddress().
func (s *Server) ScorerAddress() string { return s.scorerAddr }

// --- requests / responses ---

type scoreRequest struct {
	// InvoiceID the grade is bound to (0x-prefixed 32-byte hex). Required.
	InvoiceID string `json:"invoiceId"`

	// Exactly one of Input or EncryptedInput must be set. EncryptedInput is base64 ECIES
	// ciphertext of the same JSON, encrypted to the key served at /version.
	Input          *scoring.Input `json:"input,omitempty"`
	EncryptedInput string         `json:"encryptedInput,omitempty"`

	// ActionID and SubmissionTag are echoed into the signed envelope and must be passed
	// verbatim to attest(). ActionID defaults to the invoiceId when omitted.
	ActionID      string `json:"actionId,omitempty"`
	SubmissionTag string `json:"submissionTag,omitempty"`
}

type scoreResponse struct {
	InvoiceID     string          `json:"invoiceId"`
	ResultData    string          `json:"resultData"` // pass to attest() verbatim
	ActionID      string          `json:"actionId"`
	SubmissionTag string          `json:"submissionTag"`
	Status        uint8           `json:"status"`
	Signature     string          `json:"signature"`
	Scorer        string          `json:"scorer"`
	ModelVersion  string          `json:"modelVersion"`
	ImageDigest   string          `json:"imageDigest"`
	Score         *scoring.Result `json:"score"` // sub-scores, for display; NOT signed
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// version publishes everything a verifier needs to check a grade independently: which key
// signs, which model ran, and which image it ran from.
func (s *Server) version(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"modelVersion":     config.ModelVersion,
		"imageDigest":      s.cfg.ImageDigest,
		"scorerAddress":    s.scorerAddr,
		"chainId":          s.cfg.ChainID,
		"encryptionPubKey": s.encryptPub,
		"trustedSources":   s.cfg.TrustedSources,
	})
}

func (s *Server) score(w http.ResponseWriter, r *http.Request) {
	var req scoreRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("decoding request: %w", err))
		return
	}

	invoiceID, err := parseBytes32(req.InvoiceID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invoiceId: %w", err))
		return
	}

	in, err := s.resolveInput(req)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}

	// Provenance: refuse to grade data whose source we cannot verify, when the caller claims
	// one. See verifyProvenance for what the claim actually buys.
	if in.ProvenanceCommitment != "" {
		if err := s.verifyProvenance(*in); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
	}

	res, err := scoring.Score(*in)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}

	actionID := invoiceID
	if req.ActionID != "" {
		if actionID, err = parseBytes32(req.ActionID); err != nil {
			writeErr(w, http.StatusBadRequest, fmt.Errorf("actionId: %w", err))
			return
		}
	}
	tag := req.SubmissionTag
	if tag == "" {
		tag = "threshold"
	}

	resultData := signing.EncodeResult(signing.Result{
		InvoiceID:       invoiceID,
		Grade:           res.Grade,
		RiskScoreBps:    res.RiskScoreBps,
		DiscountRateBps: res.DiscountRateBps,
		ModelVersion:    config.ModelVersion,
		ImageDigest:     s.imageDigest,
	})

	const statusSuccess uint8 = 1
	payload := signing.Payload(
		config.ScoreResultDomain,
		s.cfg.ChainID,
		signing.ResultHash(resultData, actionID, tag, statusSuccess),
	)
	sig, err := signing.SignEIP191(s.cfg.SigningKey, payload)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}

	// Log the decision, never the inputs.
	log.Printf("scored invoice=%s grade=%s risk=%dbps discount=%dbps",
		req.InvoiceID, res.Grade, res.RiskScoreBps, res.DiscountRateBps)

	writeJSON(w, http.StatusOK, scoreResponse{
		InvoiceID:     "0x" + hex.EncodeToString(invoiceID[:]),
		ResultData:    "0x" + hex.EncodeToString(resultData),
		ActionID:      "0x" + hex.EncodeToString(actionID[:]),
		SubmissionTag: tag,
		Status:        statusSuccess,
		Signature:     "0x" + hex.EncodeToString(sig),
		Scorer:        s.scorerAddr,
		ModelVersion:  config.ModelVersion,
		ImageDigest:   s.cfg.ImageDigest,
		Score:         &res,
	})
}

// resolveInput returns the plaintext scoring input, decrypting when the caller sent ciphertext.
func (s *Server) resolveInput(req scoreRequest) (*scoring.Input, error) {
	switch {
	case req.Input != nil && req.EncryptedInput != "":
		return nil, errors.New("send exactly one of input or encryptedInput, not both")

	case req.Input != nil:
		return req.Input, nil

	case req.EncryptedInput != "":
		if s.cfg.EncryptionKey == "" {
			return nil, errors.New("encryptedInput sent but the service has no SCORER_ENCRYPTION_KEY")
		}
		key, err := ecies.NewPrivateKeyFromHex(s.cfg.EncryptionKey)
		if err != nil {
			return nil, fmt.Errorf("encryption key: %w", err)
		}
		ct, err := decodeHexOrBase64(req.EncryptedInput)
		if err != nil {
			return nil, fmt.Errorf("encryptedInput: %w", err)
		}
		plain, err := ecies.Decrypt(key, ct)
		if err != nil {
			return nil, fmt.Errorf("decrypting input: %w", err)
		}
		var in scoring.Input
		d := json.NewDecoder(strings.NewReader(string(plain)))
		d.DisallowUnknownFields()
		if err := d.Decode(&in); err != nil {
			return nil, fmt.Errorf("decoding decrypted input: %w", err)
		}
		return &in, nil

	default:
		return nil, errors.New("one of input or encryptedInput is required")
	}
}

// verifyProvenance checks that the private inputs are the ones a trusted data source vouched
// for, WITHOUT the data ever going on-chain.
//
// The source publishes commitment = keccak256(canonical(inputs) ‖ salt) and signs it. This
// service recomputes the commitment from the inputs it was actually given and checks both that
// it matches and that a trusted source signed it. A mismatch means the caller edited the data
// after the source vouched for it, and the service refuses to grade it.
//
// This replaces the Flare FDC Web2Json anchor. The trust model changes honestly: instead of an
// attestation network vouching for an HTTP response, the data source signs its own data. For a
// specific customer's private payment history — which no public API will ever serve — that is
// arguably the more appropriate model, since only the source can authenticate it at all.
// The salt stays private so the low-entropy inputs cannot be brute-forced from the commitment.
func (s *Server) verifyProvenance(in scoring.Input) error {
	if len(s.cfg.TrustedSources) == 0 {
		return errors.New("provenanceCommitment supplied but the service has no TRUSTED_SOURCES configured")
	}
	if in.ProvenanceSignature == "" {
		return errors.New("provenanceCommitment supplied without provenanceSignature")
	}

	salt, err := decodeHex(in.ProvenanceSalt)
	if err != nil {
		return fmt.Errorf("provenanceSalt: %w", err)
	}
	want, err := decodeHex(in.ProvenanceCommitment)
	if err != nil {
		return fmt.Errorf("provenanceCommitment: %w", err)
	}

	got := crypto.Keccak256(append([]byte(scoring.ProvenanceCanonical(in)), salt...))
	if !strings.EqualFold(hex.EncodeToString(got), hex.EncodeToString(want)) {
		return errors.New("provenance mismatch: the inputs do not hash to the committed value")
	}

	sig, err := decodeHex(in.ProvenanceSignature)
	if err != nil {
		return fmt.Errorf("provenanceSignature: %w", err)
	}
	signer, err := signing.RecoverEIP191(want, sig)
	if err != nil {
		return fmt.Errorf("provenanceSignature: %w", err)
	}
	for _, t := range s.cfg.TrustedSources {
		if strings.EqualFold(t, signer.Hex()) {
			return nil
		}
	}
	return fmt.Errorf("provenance signed by %s, which is not a trusted source", signer.Hex())
}
