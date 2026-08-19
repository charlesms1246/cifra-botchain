# infra/ — local dev infrastructure for the TEE round-trip

Not product code. This is the local plumbing needed to run the fce-sign TEE
extension against Coston2 without Flare's shared indexer credentials.

## indexer/

The fce-sign `ext-proxy` reads TEE events + instruction responses from a MySQL
DB populated by [`flare-system-c-chain-indexer`](https://github.com/flare-foundation/flare-system-c-chain-indexer).
We self-host it (docs sanction "run your own indexer"). The third-party repo is
cloned at `../../reference/flare-system-c-chain-indexer`; only our `config.toml`
lives here.

**Key constraints (verified, not assumed):**
- Public Coston2 RPC caps `eth_getLogs` at **30 blocks** → `log_range = 30`.
- `mode = "fsp"` auto-resolves FSP contracts via the on-chain ContractRegistry.
- DB name `flare_ftso_indexer` must match the ext-proxy `[db].database`.

**Run:**
```bash
# 1. MySQL (from the indexer repo's bundled compose)
cd ../reference/flare-system-c-chain-indexer/internal/database/docker && docker compose up -d
# 2. Indexer (from the indexer repo root)
cd ../reference/flare-system-c-chain-indexer
go run ./cmd/indexer --config /Users/charlesms/Hacks/flare/Cifra/infra/indexer/config.toml
```
