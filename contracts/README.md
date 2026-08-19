# contracts/

Cifra Solidity contracts. Scaffolding only for now — no Cifra contracts are
implemented yet (build order in `../CLAUDE.md`). Planned files:

| File | Purpose |
|---|---|
| `CifraInvoiceRegistry.sol` | Invoice registration + dedupe |
| `CifraAttestationNFT.sol` | ERC-721 holding the TEE-signed risk grade |
| `CifraTrancheController.sol` | FXRP pool + funding + senior/junior waterfall |
| `CifraTrancheVault.sol` | ERC-4626 tranche share class (deployed as senior + junior) |
| `CifraSettlement.sol` | FDC proof verification, invoice closing, explicit reserve |
| `CifraNavOracle.sol` | USD NAV via FTSO XRP/USD (one oracle per tranche) |
| `CifraJurisdictionOracle.sol` | Jurisdiction risk via FDC Web2Json |

`examples/HelloWorld.sol` is the flare-hardhat-starter example, kept only as the
toolchain deploy smoke test. Delete it once the first real contract lands.
