// Package main runs the sign-extension end-to-end test:
//  1. setExtensionId on the deployed InstructionSender (idempotent)
//  2. fetch TEE public key from the extension proxy
//  3. ECIES-encrypt a fixed test private key under the TEE pubkey
//  4. send updateKey on-chain, poll for result
//  5. send sign(testMessage) on-chain, poll for result
//  6. ABI-decode (bytes message, bytes signature) from result.Data,
//     ecrecover the signer, verify it matches the test key's address
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"math/big"
	"os"
	"strings"
	"time"

	"sign-extension/pkg/scoring"
	"sign-extension/tools/pkg/configs"
	"sign-extension/tools/pkg/fccutils"
	"sign-extension/tools/pkg/support"
	instrutils "sign-extension/tools/pkg/utils"

	ethereum "github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/crypto/ecies"
	"github.com/ethereum/go-ethereum/ethclient"
	csigning "github.com/flare-foundation/go-flare-common/pkg/signing"
	"github.com/flare-foundation/go-flare-common/pkg/logger"
	"github.com/flare-foundation/tee-node/pkg/types"
	"github.com/pkg/errors"
)

func main() {
	af := flag.String("a", configs.AddressesFile, "file with deployed addresses")
	cf := flag.String("c", configs.ChainNodeURL, "chain node url")
	pf := flag.String("p", configs.ExtensionProxyURL, "extension proxy url")
	instructionSenderF := flag.String("instructionSender", os.Getenv("INSTRUCTION_SENDER"), "InstructionSender contract address")
	modeF := flag.String("mode", "key", "test mode: 'key' (updateKey + sign) or 'score' (Cifra invoice scoring)")
	flag.Parse()

	if *instructionSenderF == "" {
		logger.Fatal("--instructionSender flag is required (or set INSTRUCTION_SENDER in .env)")
	}

	instructionSenderAddress := common.HexToAddress(*instructionSenderF)

	testSupport, err := support.DefaultSupport(*af, *cf)
	if err != nil {
		fccutils.FatalWithCause(err)
	}

	// --- Step 1: setExtensionId ---
	logger.Infof("Step 1: Setting extension ID on InstructionSender...")
	if err := instrutils.SetExtensionId(testSupport, instructionSenderAddress); err != nil {
		if strings.Contains(err.Error(), "already set") || strings.Contains(err.Error(), "Extension ID already set") {
			logger.Infof("  Extension ID already set on contract, continuing")
		} else {
			fccutils.FatalWithCause(errors.Errorf(
				"setExtensionId failed — is the extension registered? Check pre-build.sh completed. Error: %s", err))
		}
	} else {
		logger.Infof("  Extension ID set.")
	}

	// --- Step 2: Fetch TEE public key and ECIES-encrypt a test private key ---
	logger.Infof("Step 2: Fetching TEE public key from extension proxy...")
	teeInfo, err := fccutils.TeeInfo(*pf)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("fetch TEE info: %s", err))
	}

	ecdsaPub, err := types.ParsePubKey(teeInfo.MachineData.PublicKey)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("parse TEE public key: %s", err))
	}

	eciesPub := &ecies.PublicKey{
		X:      ecdsaPub.X,
		Y:      ecdsaPub.Y,
		Curve:  ecies.DefaultCurve,
		Params: ecies.ECIES_AES128_SHA256,
	}

	// Cifra scoring round-trip: encrypt synthetic buyer data, score it in the
	// enclave, and verify the returned grade matches the reference model.
	if *modeF == "score" {
		runScoreTest(testSupport, instructionSenderAddress, eciesPub, *pf)
		return
	}

	// Fixed test private key for deterministic verification.
	testPrivKeyHex := "fad9c8855b740a0b7ed4c221dbad0f33a83a49cad6b3fe8d5817ac83d38b6a19"
	testPrivKeyBytes, _ := hex.DecodeString(testPrivKeyHex)
	testPrivKey, err := crypto.ToECDSA(testPrivKeyBytes)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("parse test private key: %s", err))
	}
	testAddress := crypto.PubkeyToAddress(testPrivKey.PublicKey)
	logger.Infof("  Test private key address: %s", testAddress.Hex())

	ciphertext, err := ecies.Encrypt(rand.Reader, eciesPub, testPrivKeyBytes, nil, nil)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("ECIES encrypt: %s", err))
	}
	logger.Infof("  Encrypted key: %d bytes", len(ciphertext))

	// --- Step 3: updateKey ---
	logger.Infof("Step 3: Sending updateKey instruction on-chain...")
	updateKeyID, _, err := instrutils.SendUpdateKey(testSupport, instructionSenderAddress, ciphertext)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("updateKey: %s", err))
	}
	logger.Infof("  updateKey instruction ID: %s", updateKeyID.Hex())

	time.Sleep(5 * time.Second)

	// --- Step 4: poll for updateKey result ---
	logger.Infof("Step 4: Waiting for updateKey result...")
	updateResp, err := fccutils.ActionResult(*pf, updateKeyID)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("poll updateKey: %s", err))
	}
	if updateResp.Result.Status == 0 {
		fccutils.FatalWithCause(errors.Errorf("updateKey instruction failed: %s", updateResp.Result.Log))
	}
	logger.Infof("  updateKey succeeded (status=%d)", updateResp.Result.Status)

	// --- Step 5: sign ---
	logger.Infof("Step 5: Sending sign instruction on-chain...")
	testMessage := []byte("Hello from the sign extension e2e test!")
	signID, _, err := instrutils.SendSign(testSupport, instructionSenderAddress, testMessage)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("sign: %s", err))
	}
	logger.Infof("  sign instruction ID: %s", signID.Hex())

	time.Sleep(5 * time.Second)

	// --- Step 6: poll for sign result and verify ---
	logger.Infof("Step 6: Waiting for sign result...")
	signResp, err := fccutils.ActionResult(*pf, signID)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("poll sign: %s", err))
	}
	if signResp.Result.Status == 0 {
		fccutils.FatalWithCause(errors.Errorf("sign instruction failed: %s", signResp.Result.Log))
	}

	// The result data is ABI-encoded (bytes, bytes) = (originalMessage, signature).
	_, sigBytes, err := abiDecodeTwo(signResp.Result.Data)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("ABI decode (bytes,bytes): %s", err))
	}
	logger.Infof("  Signature: %s", hex.EncodeToString(sigBytes))

	// Recover signer. signECDSA in the TEE returns [r,s,v] where v is 27 or 28;
	// SigToPub expects v in [0,3], so normalize.
	msgHash := crypto.Keccak256(testMessage)
	recoveredPub, err := crypto.SigToPub(msgHash, normalizeV(sigBytes))
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("ecrecover: %s", err))
	}
	recoveredAddr := crypto.PubkeyToAddress(*recoveredPub)
	logger.Infof("  Recovered signer: %s", recoveredAddr.Hex())
	logger.Infof("  Expected signer:  %s", testAddress.Hex())

	if recoveredAddr != testAddress {
		fccutils.FatalWithCause(errors.Errorf("FAIL: recovered signer %s does not match expected %s", recoveredAddr.Hex(), testAddress.Hex()))
	}

	logger.Infof("All tests passed.")
}

// readJurisdictionRiskBps reads jurisdictionRiskBps(country) from the on-chain
// CifraJurisdictionOracle (the FDC Web2Json jurisdiction source).
func readJurisdictionRiskBps(client *ethclient.Client, oracleHex, code string) (uint32, error) {
	parsed, err := abi.JSON(strings.NewReader(`[{"type":"function","name":"jurisdictionRiskBps","stateMutability":"view","inputs":[{"type":"string"}],"outputs":[{"type":"uint32"}]}]`))
	if err != nil {
		return 0, err
	}
	data, err := parsed.Pack("jurisdictionRiskBps", code)
	if err != nil {
		return 0, err
	}
	addr := common.HexToAddress(oracleHex)
	out, err := client.CallContract(context.Background(), ethereum.CallMsg{To: &addr, Data: data}, nil)
	if err != nil {
		return 0, err
	}
	vals, err := parsed.Unpack("jurisdictionRiskBps", out)
	if err != nil {
		return 0, err
	}
	risk, ok := vals[0].(uint32)
	if !ok {
		return 0, fmt.Errorf("unexpected return type %T", vals[0])
	}
	return risk, nil
}

// runScoreTest exercises the Cifra CIFRA/SCORE round-trip: it encrypts synthetic
// buyer payment-history data to the TEE public key, dispatches a sendScore
// instruction, then verifies the enclave-returned grade matches the reference
// model computed locally on the same input.
func runScoreTest(s *support.Support, instructionSenderAddress common.Address, eciesPub *ecies.PublicKey, proxyURL string) {
	// Bind this score to a specific invoice (H1). Set INVOICE_ID to the on-chain invoiceId
	// you will attest to; otherwise a demo placeholder is used.
	invoiceIDHex := os.Getenv("INVOICE_ID")
	if invoiceIDHex == "" {
		invoiceIDHex = "0x" + strings.Repeat("11", 32)
		logger.Warnf("INVOICE_ID unset — using demo placeholder %s (set INVOICE_ID to bind a real invoice)", invoiceIDHex)
	}

	// Buyer payment-history data. v1: synthetic. v2: same fields, but sourced from a mock
	// accounting API and provenance-committed (Stage B); jurisdiction pulled live from the
	// on-chain Web2Json oracle (Stage A).
	in := scoring.Input{
		InvoiceID:           invoiceIDHex,
		InvoicesPaidOnTime:  88,
		InvoicesTotal:       100,
		InvoiceAmount:       120_000,
		HistoricalAvgVolume: 100_000,
		TenorDays:           30,
		JurisdictionCode:    "US",
	}

	// v2 Stage A — jurisdiction from the on-chain CifraJurisdictionOracle (FDC Web2Json).
	if oracle := os.Getenv("JURISDICTION_ORACLE"); oracle != "" {
		if c := os.Getenv("JURISDICTION_CODE"); c != "" {
			in.JurisdictionCode = c
		}
		if riskBps, err := readJurisdictionRiskBps(s.ChainClient, oracle, in.JurisdictionCode); err != nil {
			logger.Warnf("jurisdiction oracle read failed (%v) — falling back to the static table", err)
		} else {
			if riskBps > 10000 {
				riskBps = 10000
			}
			in.JurisdictionScoreBps = 10000 - riskBps // oracle reports risk; the model uses a score (higher = safer)
			logger.Infof("  Jurisdiction (Web2Json oracle): %s risk %d bps -> score %d bps", in.JurisdictionCode, riskBps, in.JurisdictionScoreBps)
		}
	}

	// v2 Stage B — bind a provenance commitment over the PRIVATE inputs. The enclave recomputes
	// keccak256(canonical ‖ salt) and refuses to sign unless it matches; the same commitment is
	// attested on-chain via FDC Web2Json over the source API (scripts/attestPaymentProvenance.ts).
	salt := os.Getenv("PROVENANCE_SALT")
	if salt == "" {
		salt = "0x" + strings.Repeat("cf", 32) // demo salt (kept private; blocks brute-force)
	}
	in.ProvenanceSalt = salt
	saltBytes, err := hexutil.Decode(salt)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("provenance salt: %s", err))
	}
	in.ProvenanceCommitment = hexutil.Encode(crypto.Keccak256(append([]byte(scoring.ProvenanceCanonical(in)), saltBytes...)))
	logger.Infof("  Provenance commitment: %s (enclave verifies; Web2Json-attestable)", in.ProvenanceCommitment)

	want, err := scoring.Score(in)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("reference score: %s", err))
	}
	logger.Infof("  Reference model: grade=%s riskBps=%d discountBps=%d", want.Grade, want.RiskScoreBps, want.DiscountRateBps)

	plaintext, err := json.Marshal(in)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("marshal buyer data: %s", err))
	}
	ciphertext, err := ecies.Encrypt(rand.Reader, eciesPub, plaintext, nil, nil)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("ECIES encrypt buyer data: %s", err))
	}
	logger.Infof("Sending sendScore instruction on-chain (encrypted buyer data: %d bytes)...", len(ciphertext))

	scoreID, _, err := instrutils.SendScore(s, instructionSenderAddress, ciphertext)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("sendScore: %s", err))
	}
	logger.Infof("  sendScore instruction ID: %s", scoreID.Hex())

	time.Sleep(5 * time.Second)

	resp, err := fccutils.ActionResult(proxyURL, scoreID)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("poll sendScore: %s", err))
	}
	if resp.Result.Status == 0 {
		fccutils.FatalWithCause(errors.Errorf("sendScore instruction failed: %s", resp.Result.Log))
	}

	gotInvoiceID, grade, riskBps, discountBps, err := abiDecodeScore(resp.Result.Data)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("ABI decode score result: %s", err))
	}
	logger.Infof("  Enclave result:  invoiceId=%s grade=%s riskBps=%d discountBps=%d", gotInvoiceID, grade, riskBps, discountBps)

	if grade != want.Grade || riskBps != uint64(want.RiskScoreBps) || discountBps != uint64(want.DiscountRateBps) {
		fccutils.FatalWithCause(errors.Errorf(
			"FAIL: enclave result (%s/%d/%d) does not match reference (%s/%d/%d)",
			grade, riskBps, discountBps, want.Grade, want.RiskScoreBps, want.DiscountRateBps))
	}
	if !strings.EqualFold(gotInvoiceID, invoiceIDHex) {
		fccutils.FatalWithCause(errors.Errorf(
			"FAIL: enclave did not bind the invoiceId: got %s, committed %s", gotInvoiceID, invoiceIDHex))
	}

	logger.Infof("Score round-trip verified: enclave grade %q bound to invoiceId %s.", grade, gotInvoiceID)

	// Capture everything CifraAttestationNFT.attest() needs, and recover the TEE signer
	// under both candidate schemes so we can confirm which one the contract must use.
	chainID := s.ChainID.Uint64()
	resultHash := resp.Result.Hash() // keccak256(keccak256(data)||id||keccak256(tag)||status)
	payloadHash, err := csigning.NewPayload(csigning.TEEActionResult, chainID, common.BytesToHash(resultHash)).Hash()
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("payload hash: %s", err))
	}
	recover := func(h []byte) string {
		pub, e := crypto.SigToPub(h, resp.Signature)
		if e != nil {
			return "recover-error"
		}
		return crypto.PubkeyToAddress(*pub).Hex()
	}
	signerRaw := recover(payloadHash[:])
	signerEip191 := recover(accounts.TextHash(payloadHash[:]))
	logger.Infof("  TEE signer  raw-payload=%s  EIP-191=%s", signerRaw, signerEip191)

	inputs := map[string]interface{}{
		"boundInvoiceId": gotInvoiceID,
		"invoiceHint":    "attest this result to the invoice whose id == boundInvoiceId (the signature binds it)",
		"resultData":     hexutil.Encode(resp.Result.Data),
		"actionId":      resp.Result.ID.Hex(),
		"submissionTag": string(resp.Result.SubmissionTag),
		"status":        resp.Result.Status,
		"signature":     hexutil.Encode(resp.Signature),
		"chainId":       chainID,
		"signerRaw":     signerRaw,
		"signerEip191":  signerEip191,
		"grade":         grade,
		"riskBps":       riskBps,
		"discountBps":   discountBps,
	}
	b, _ := json.MarshalIndent(inputs, "", "  ")
	if e := os.WriteFile("attest-inputs.json", b, 0o644); e != nil {
		logger.Warnf("could not write attest-inputs.json: %s", e)
	} else {
		logger.Infof("  wrote attest-inputs.json (attest() inputs + recovered signers)")
	}
}

// abiDecodeScore decodes ABI (bytes32 invoiceId, bytes32 grade, uint256 riskScoreBps,
// uint256 discountRateBps).
func abiDecodeScore(data []byte) (string, string, uint64, uint64, error) {
	if len(data) < 128 {
		return "", "", 0, 0, fmt.Errorf("data too short for (bytes32,bytes32,uint256,uint256): %d bytes", len(data))
	}
	invoiceID := hexutil.Encode(data[0:32])
	grade := strings.TrimRight(string(data[32:64]), "\x00")
	risk := new(big.Int).SetBytes(data[64:96]).Uint64()
	discount := new(big.Int).SetBytes(data[96:128]).Uint64()
	return invoiceID, grade, risk, discount, nil
}

// normalizeV converts a 65-byte [r,s,v] signature where v is 27 or 28 into the
// form expected by go-ethereum's SigToPub (v in [0,3]).
func normalizeV(sig []byte) []byte {
	if len(sig) != 65 {
		return sig
	}
	out := make([]byte, 65)
	copy(out, sig)
	if out[64] >= 27 {
		out[64] -= 27
	}
	return out
}

// abiDecodeTwo decodes ABI-encoded (bytes, bytes).
func abiDecodeTwo(data []byte) ([]byte, []byte, error) {
	if len(data) < 64 {
		return nil, nil, fmt.Errorf("data too short for (bytes,bytes): %d bytes", len(data))
	}
	offset1 := new(big.Int).SetBytes(data[0:32]).Uint64()
	offset2 := new(big.Int).SetBytes(data[32:64]).Uint64()

	readBytes := func(offset uint64) ([]byte, error) {
		if int(offset)+32 > len(data) {
			return nil, fmt.Errorf("offset %d out of range", offset)
		}
		length := new(big.Int).SetBytes(data[offset : offset+32]).Uint64()
		start := offset + 32
		if int(start+length) > len(data) {
			return nil, fmt.Errorf("length %d exceeds data at offset %d", length, offset)
		}
		return data[start : start+length], nil
	}

	a, err := readBytes(offset1)
	if err != nil {
		return nil, nil, err
	}
	b, err := readBytes(offset2)
	if err != nil {
		return nil, nil, err
	}
	return a, b, nil
}
