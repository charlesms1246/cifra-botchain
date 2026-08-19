# Cifra scoring service

Runs Cifra's invoice risk model over a buyer's private payment history and returns a signed
grade that `CifraAttestationNFT` accepts on-chain.

Stateless: no database, no queue, no persistence. Inputs are held in memory for the length of
one request and never written anywhere — only the decision is logged.

## What this replaced, and what changed about the trust model

This used to be a Flare Confidential Compute extension running inside a Confidential Space
enclave, reached through an on-chain instruction relayed by Flare's data providers. Buyer data
was ECIES-encrypted so the relays could not read it, and the signing key was bound by hardware
attestation to a specific code hash.

**On Cloud Run there is no hardware attestation.** Cloud Run is not a Confidential Space host
and issues no attestation token bound to an image digest. So the honest claim is narrower than
the one this project used to make, and it is worth stating exactly:

| Claim | Flare TEE | Here |
|---|---|---|
| The grade came from the registered key | ✅ | ✅ |
| The grade is bound to one invoice | ✅ | ✅ |
| Raw buyer data never reaches the chain | ✅ | ✅ |
| The published model produced it | ✅ hardware-attested | ⚠️ **claimed, and checkable — not proven** |
| The operator cannot read buyer data | ✅ | ❌ **no** |

What makes the fourth row *checkable* rather than merely asserted: the service signs the
`modelVersion` and the container `imageDigest` alongside the grade, and both are recorded
on-chain. Anyone can pull that exact image, re-run it on the same inputs, and confirm they get
the same result. What that still cannot prove is that the running container *was* that image —
only attestation can, and this is the honest gap.

The upgrade path is deliberately left open: `CifraAttestationNFT.setScorerAddress()` is
owner-settable, so moving to a GCE Confidential Space VM later is a key rotation, not a
contract migration.

**On encryption.** ECIES payload encryption is still supported, but it no longer does what it
did on Flare. There is no relay to hide from — the client talks to this service directly over
TLS, and the operator can read any request. It is worth keeping because it keeps buyer data out
of proxy and request logs, but calling it confidentiality against the operator would be false.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/healthz` | liveness |
| `GET` | `/version` | model version, image digest, scorer address, chain id, encryption pubkey |
| `POST` | `/score` | score a buyer and sign the result |

### `POST /score`

```jsonc
{
  "invoiceId": "0x…32 bytes",           // required; the grade is bound to it
  "input": {                             // plaintext …
    "invoiceId": "0x…",
    "invoicesPaidOnTime": 47,
    "invoicesTotal": 48,
    "invoiceAmount": 500000,
    "historicalAvgVolume": 900000,
    "tenorDays": 30,
    "jurisdictionCode": "DE"
  },
  "encryptedInput": "0x…",               // … or ECIES ciphertext of the same JSON (never both)
  "actionId": "0x…",                     // optional, defaults to invoiceId
  "submissionTag": "threshold"           // optional
}
```

The response carries `resultData`, `actionId`, `submissionTag`, `status` and `signature` —
pass all five to `CifraAttestationNFT.attest()` verbatim. `score` holds the sub-scores for
display and is **not** covered by the signature.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `SCORER_SIGNING_KEY` | ✅ | hex secp256k1 key. **Its address must equal `CifraAttestationNFT.scorerAddress()`** or every `attest()` reverts with `BadScorerSignature`. |
| `CHAIN_ID` | ✅ | 677 mainnet / 968 testnet. Bound into every signature so a grade cannot be replayed across networks. |
| `SCORER_ENCRYPTION_KEY` | — | hex secp256k1 key for ECIES payloads. Omit to accept plaintext only. Kept separate from the signing key on purpose. |
| `IMAGE_DIGEST` | — | container digest, signed into every result. Empty = unpinned local build, recorded on-chain as zero. |
| `TRUSTED_SOURCES` | — | comma-separated addresses allowed to sign a provenance commitment. Empty disables provenance enforcement. |
| `PORT` | — | defaults to 8080 (Cloud Run's contract). |

## Provenance — what replaced FDC Web2Json

Optional. When a request carries `provenanceCommitment`, `provenanceSalt` and
`provenanceSignature`, the service recomputes `keccak256(canonical(inputs) ‖ salt)`, checks it
matches the commitment, and checks a `TRUSTED_SOURCES` address signed it. If any of that fails
it **refuses to score**.

So a funder can confirm the grade was computed on data the source vouched for, without the data
being disclosed to them or put on-chain. The salt stays private because the inputs are
low-entropy enough to brute-force from a bare commitment.

The trust model changed honestly: instead of an attestation network vouching for an HTTP
response, the data source signs its own data. For a specific customer's private payment history
— which no public API will ever serve — only the source can authenticate it, so this is
arguably the more appropriate model as well as the portable one. zkTLS / web proofs
(Reclaim, vlayer, TLSNotary) are the trust-minimizing upgrade and are chain-agnostic.

## Running locally

```bash
go test ./...
go build -o /tmp/scorer .

SCORER_SIGNING_KEY=<hex key, no 0x> CHAIN_ID=968 PORT=8099 /tmp/scorer
curl -s localhost:8099/version | jq
```

End-to-end against a deployed book (register → score → attest → fund → settle/default):

```bash
SCORER_URL=http://localhost:8099 \
  npx hardhat run scripts/e2eLifecycle.ts --network botchainTestnet
```

That script is the real cross-language test: the Go signature has to be accepted by Solidity's
`ecrecover`, or nothing downstream happens.

## Deploying to Cloud Run

```bash
PROJECT=my-gcp-project REGION=europe-west1 CHAIN_ID=968 ./deploy-cloudrun.sh
```

The script builds, resolves the **immutable digest** (never a tag — a tag can be repointed
later, which would make the on-chain record meaningless), deploys with the key from Secret
Manager, and prints the scorer address.

Create the secret once:

```bash
printf '%s' "<hex key, no 0x>" | \
  gcloud secrets create cifra-scorer-signing-key --data-file=- --project=$PROJECT
```

**Then register the key on-chain** as the `CifraAttestationNFT` owner:

```solidity
attestation.setScorerAddress(<scorerAddress from /version>)
```

Until that lands, every `attest()` reverts.

The service deploys `--no-allow-unauthenticated`; the attester calls it with a Google identity
token. It should not be public — it is not a rate-limited endpoint and scoring is the step that
gates funding.

## Reproducing a grade

Given an on-chain grade, a reviewer can check it end to end:

1. Read `gradeForInvoice(invoiceId)` → `modelVersion`, `imageDigest`, `scorerSigner`.
2. Pull that image by digest and run it with the same inputs.
3. Compare `resultData`.
4. Confirm `scorerSigner` matches `scorerAddress()` at the time of attestation.

The `Dockerfile` builds a static, `-trimpath`, stripped binary specifically so step 2 is
reproducible across machines.
