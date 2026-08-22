# Cifra — Clone & Run

Everything you need to clone the repo and run any layer — contracts, the scoring service, and
the live end-to-end flow.

```bash
git clone git@github.com:charlesms1246/Cifra.git
cd Cifra
```

---

## 1. The web app

A Next.js app pointed at BOT Chain, reading live on-chain data. It needs no environment
variables to run.

```bash
cd frontend
npm install --legacy-peer-deps    # see the Privy note below
npm run dev                        # → http://localhost:3000
```

You get the landing page, the funder vault (both books, with native-BOT deposits), the invoice
marketplace, an invoice detail view with pay/default, and the factoring form.

Addresses come from `frontend/lib/deployment.json`, a copy of `deployments/cifra-<network>.json`
written by the deploy script. Re-sync it after any deploy:

```bash
NETWORK=botchainTestnet npx ts-node scripts/syncFrontendDeployment.ts
```

**Wallets.** Injected wallets work with no configuration. Privy is optional — set
`NEXT_PUBLIC_PRIVY_APP_ID` to enable email/social login and embedded wallets. Without it the app
still builds and runs on injected wallets alone.

⚠️ `@privy-io/wagmi` pins `viem` to an exact version and its optional `permissionless`/`ox`
sub-tree conflicts, so frontend installs need `--legacy-peer-deps`. `package.json` carries a
matching `viem` pin and an `overrides` entry.

**Deploy to Vercel:** import the repo, set **Root Directory = `frontend`**, and deploy. No
environment variables are required (add `NEXT_PUBLIC_PRIVY_APP_ID` if you want Privy). Vercel
only sees `frontend/`, which is why the deployment record is copied into `lib/`.

---

## 2. Contracts (Hardhat)

**Prerequisites:** Node 20+.

```bash
# from the repo root
npm install
cp .env.example .env         # set PRIVATE_KEY
npx hardhat test             # registry, attestation, waterfall, settlement, oracle, helper
FORK=1 npx hardhat test test/fork/MainnetFork.test.ts   # against real mainnet state
```

Get testnet gas from [`faucet.botchain.ai/basic`](https://faucet.botchain.ai/basic) — 10 tBOT
per address per 24h, which is far more than a full deploy needs (~0.25 BOT).

Deploy both books (native BOT + USDT) and verify the wiring on-chain:

```bash
npx hardhat run scripts/deployCifra.ts --network botchainTestnet
npx hardhat run scripts/checkDeploy.ts --network botchainTestnet
```

`deployCifra.ts` deploys a **shared** registry + attestation NFT, then one
controller / senior / junior / settlement set per asset. Addresses land in
`deployments/cifra-<network>.json`, which is the source of truth everywhere else.

| Env var | Effect |
|---|---|
| `CIFRA_SCORER_ADDRESS` | the scoring service's signing key (default: deployer, changeable later) |
| `CIFRA_OPERATOR` | the keeper permitted to call `fundInvoice` (default: deployer) |
| `CIFRA_BOOKS` | subset to deploy, e.g. `usdt` (default: `bot,usdt`) |
| `CIFRA_GRACE_DAYS` | days past due before an invoice can be defaulted (default: 3) |
| `VERIFY=false` | skip Blockscout source verification |

> **Never share addresses across networks.** The mainnet USDT address resolves to a *different
> token* (`WES`) on testnet — it has code and answers ERC-20 calls, so it would transact
> silently. Everything external is resolved per chain id through
> [`config/networks.ts`](config/networks.ts).

---

## 3. The scoring service

Go, stateless, runs on Cloud Run. Full detail in [`scorer/README.md`](scorer/README.md).

```bash
cd scorer
go test ./...
go build -o /tmp/scorer .

SCORER_SIGNING_KEY=<hex key, no 0x> CHAIN_ID=968 PORT=8099 /tmp/scorer
curl -s localhost:8099/version | jq
```

The address at `/version` **must equal `CifraAttestationNFT.scorerAddress()`** or every
`attest()` reverts with `BadScorerSignature`. For local runs, use the deployer key (which is the
default scorer). In production:

```bash
PROJECT=my-gcp-project REGION=europe-west1 CHAIN_ID=968 ./deploy-cloudrun.sh
# then, as the contract owner:
#   attestation.setScorerAddress(<scorerAddress from /version>)
```

---

## 4. The live end-to-end flow

With a deployed book and the scorer running:

```bash
SCORER_URL=http://localhost:8099 \
  npx hardhat run scripts/e2eLifecycle.ts --network botchainTestnet
```

That runs both paths — `register → score → attest → fund → pay` and
`register → score → attest → fund → default` — taking grades from the real service over HTTP.
The attest step is the cross-language check: a Go signature has to survive Solidity's
`ecrecover`.

Two disclosed shortcuts, both printed by the script:
- one key plays supplier, funder, keeper and buyer;
- the default leg temporarily repoints the controller at a throwaway
  `CifraSettlement(grace = 0)`, because production grace is 3 days and a live chain cannot
  time-travel. Same logic, different constant; the real settlement is restored afterwards.

### Other scripts

| Script | What it does |
|---|---|
| `deployCifra.ts` | deploy both books + shared layer, verify source |
| `checkDeploy.ts` | 47 on-chain assertions against the deployment record |
| `e2eLifecycle.ts` | the full lifecycle, both paths, live |
| `depositTranches.ts` | seed senior + junior |
| `seedFundable.ts` / `registerOne.ts` / `listUnscored.ts` | invoice fixtures and inspection |
| `checkGasModel.ts` | proves viem's default fee path works on this chain |
| `deployGovSafe.ts` → `setRoles.ts` → `transferOwnershipToGov.ts` → `verifyGov.ts` | governance handover, **in that order** |
| `safeExec.ts` | execute an owner-gated call through the Safe |

> **Order matters in the governance sequence.** `setRoles.ts` writes owner-gated setters, so it
> must run while the deployer still owns the contracts. After `transferOwnershipToGov.ts` every
> role change becomes a multi-sig proposal instead of a transaction.

> Safe is deployed on BOT Chain **mainnet** (1.3.0 and 1.4.1) but **not on testnet**, so the
> governance scripts only work against 677 unless you deploy Safe to 968 yourself.

---

## Networks

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 677 | 968 |
| RPC | `https://rpc.botchain.ai` | `https://rpc.bohr.life` |
| Explorer | https://scan.botchain.ai | https://scan.bohr.life |
| Faucet | — | https://faucet.botchain.ai/basic (10 tBOT / 24h) |
| Gas | fixed 20 gwei | fixed 20 gwei |
| Block time | ~0.67 s | ~0.66 s |

Both are Blockscout, so `hardhat verify` works with any non-empty API key.
**Multicall3 is not deployed on testnet** — frontend chain definitions must omit it there or
batched reads will fail.
