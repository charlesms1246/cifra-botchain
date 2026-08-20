# contracts/

Cifra's Solidity layer on BOT Chain.

The stack is deployed **once per settlement asset** ("a book"). The registry and the attestation
NFT are shared across books; everything below them is per-asset, because an invoice is faced,
funded and repaid in the same token and nothing here ever converts between assets.

## Shared

| File | Purpose |
|---|---|
| `CifraInvoiceRegistry.sol` | Invoice registration + dedupe. The buyer is an opaque commitment hash. |
| `CifraAttestationNFT.sol` | ERC-721 holding the signed risk grade, plus the `modelVersion` and container `imageDigest` that produced it. Verifies the scorer's signature and the invoice binding. |

## Per book

| File | Purpose |
|---|---|
| `CifraTrancheController.sol` | Holds the book's pooled asset; funding + senior/junior waterfall. |
| `CifraTrancheVault.sol` | ERC-4626 tranche share class (deployed as senior + junior). |
| `CifraSettlement.sol` | On-chain repayment; default is a `block.timestamp` check. No oracle, no reserve. |
| `CifraNativeDepositHelper.sol` | One-transaction native BOT → WBOT → tranche, and back. Native book only. |
| `CifraNavOracle.sol` | **Display only** — prices a volatile book's NAV via a BDEX V3 TWAP. Nothing economic reads it. Not deployed for the USDT book. |

## Leftover from the Flare build

| File | Status |
|---|---|
| `CifraJurisdictionOracle.sol` | ⚠️ **The last contract still importing `@flarenetwork`** (FDC Web2Json). Not deployed on BOT Chain. `claude-docs/PORTING_ANALYSIS.md` §6.1 recommends deleting it and folding the country→region map into the already-governance-set risk table; that call has not been made, and until it is the `@flarenetwork` dependency cannot be dropped. |
| `examples/HelloWorld.sol` | Toolchain deploy smoke test. Safe to delete. |

## Conventions worth knowing before editing

- **Immutables are `UPPER_CASE`** (`ASSET`, `REGISTRY`, `CONTROLLER`). This deliberately
  contradicts solhint's `immutable-vars-naming` rule, which is why that rule reports errors on a
  clean tree — match the codebase, not the linter.
- **`prettier --write` will reformat every file.** The repo's `.prettierrc` disagrees with how
  the Solidity is actually written, so running it produces hundreds of lines of unrelated churn.
  Leave it alone.
- The signing domain in `CifraAttestationNFT` (`bytes32("CIFRA_SCORE_RESULT")`) is effectively
  part of the ABI: `scorer/internal/config` must match it byte for byte or every `attest()`
  reverts.
