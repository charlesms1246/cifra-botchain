# Cifra — Clone & Run

Everything you need to clone the repo and run any layer — from just the web app (zero config) to the full TEE round-trip.

```bash
git clone git@github.com:charlesms1246/Cifra.git
cd Cifra
```

---

## 1. The web app (easiest — no keys, no config)

The frontend is a Next.js app that reads **live** Coston2 data and submits XRPL payments client-side. It needs **no environment variables**.

```bash
cd frontend
npm install
npm run dev            # → http://localhost:3000
```

You'll get the landing page, the funder dashboard (live FTSO-priced NAV + real FXRP deposit), the invoice marketplace (live on-chain invoices), the XRPL-native onboarding flow, and the `/pitch` deck. To transact you need a browser wallet (e.g. MetaMask) on **Coston2** with a little **C2FLR** gas — get it from the [faucet](https://faucet.flare.network/coston2).

**Deploy to Vercel:** import the repo, set **Root Directory = `frontend`**, leave env vars empty, deploy.

---

## 2. Contracts (Hardhat)

**Prerequisites:** Node 20+.

```bash
# from the repo root
npm install
cp .env.example .env         # set PRIVATE_KEY (a funded Coston2 key)
npx hardhat test             # unit tests: registry, attestation binding, tranche waterfall, settlement + reserve, oracles

# deploy the full product layer to Coston2 (resolves FXRP + FdcVerification + FtsoV2 on-chain):
FLARE_RPC_API_KEY="" npx hardhat run scripts/deployCifra.ts --network coston2
```

> Run deploy/verify/settle scripts with `FLARE_RPC_API_KEY=""` — the tracer endpoint wants a key the public RPC doesn't.

The FDC scripts (settlement, default, Web2Json) additionally need these in `.env`:

```
VERIFIER_URL_TESTNET=...
VERIFIER_API_KEY_TESTNET=...
COSTON2_DA_LAYER_URL=...
```

---

## 3. The TEE extension (the confidential-compute core)

**Prerequisites:** Docker (Desktop), Go 1.22+, an [ngrok](https://ngrok.com) account (to expose the enclave proxy to Flare's data-provider network). The extension lives in `tee-extension/` (Go).

Bring the stack up and register + promote a TEE machine on Coston2:

```bash
cd tee-extension

# 1. register the extension + InstructionSender on-chain
CHAIN_URL="https://coston2-api.flare.network/ext/C/rpc" bash scripts/pre-build.sh --force

# 2. build + start the enclave, proxy, and redis (Docker), exposed via ngrok
set -a && source config/extension.env && set +a
bash scripts/start-services.sh --chain coston2

# 3. register + promote the TEE machine to PRODUCTION
CHAIN_URL="https://coston2-api.flare.network/ext/C/rpc" bash scripts/post-build.sh
```

Then score an invoice **immediately** (the score-forwarding window opens right after a fresh promotion). This one command shows both v2 stages — jurisdiction from an on-chain Web2Json oracle, and the private-input provenance commitment the enclave verifies before signing:

```bash
set -a && source .env && set +a && cd go/tools
INVOICE_ID=<0x…> JURISDICTION_ORACLE=<oracle addr> JURISDICTION_CODE=US \
  go run ./cmd/run-test -mode score \
  -a ../../config/coston2/deployed-addresses.json \
  -c https://coston2-api.flare.network/ext/C/rpc \
  -instructionSender <new InstructionSender from config/extension.env> \
  -p https://<your-ngrok-domain>
```

**Keeping it up:** the enclave runs on a machine you control (Docker + ngrok) — it is *not* part of the Vercel deployment, and the web app reads its results only through the chain. Prevent your machine from sleeping (`caffeinate -dimsu` on macOS), keep Docker + ngrok alive, and re-run the `pre-build --force → start-services → post-build` cycle right before any live scoring.

---

## 4. The live end-to-end flow (scripts)

Once the TEE stack is up and an invoice is scored, the on-chain steps are ordinary scripts:

```bash
FLARE_RPC_API_KEY="" npx hardhat run scripts/<name>.ts --network coston2
```

| Script | What it does |
|---|---|
| `directMint.ts` | 10 XRP → FAssets Core Vault → real FXRP minted |
| `registerViaSmartAccount.ts` | XRPL-native onboarding: register an invoice from a single XRPL payment (no EVM wallet) |
| `executeOnboard.ts` | operator executor for a browser-originated onboarding (FDC + `executeDirectMinting`) |
| `depositTranches.ts` | seed the senior + junior tranches with FXRP |
| `realSettlePrep.ts` → `realSettle.ts` | register → attest (real TEE grade) → fund → XRPL pay → FDC `Payment` → settle (50/50 split) |
| `defaultPrep.ts` → `defaultSettle.ts` | fund → FDC `ReferencedPaymentNonexistence` → `markDefault` (junior first-loss) |
| `deployGovSafe.ts` → `transferOwnershipToGov.ts` → `verifyGov.ts` | 2-of-3 Safe governance + ownership transfer |
| `safeExec.ts` | execute an owner-gated call through the 2-of-3 Safe |
| `attestPaymentProvenance.ts` | anchor a payment-history provenance commitment on-chain via FDC `Web2Json` |

---

## Networks

| | |
|---|---|
| Chain ID | 114 (Coston2) |
| RPC | `https://coston2-api.flare.network/ext/C/rpc` |
| Explorer | https://coston2-explorer.flare.network |
| Faucet | https://faucet.flare.network/coston2 (C2FLR, FXRP) |
