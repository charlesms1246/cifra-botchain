import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

// Cifra targets BOT Chain (mainnet 677 / testnet 968). The Flare networks are
// retained only so the original Coston2 deployment stays reproducible while the
// port is in flight; they are not deployment targets any more.
//
// evmVersion "cancun" is safe on BOT Chain: its block headers carry
// `requestsHash`/`parentBeaconBlockRoot`, so the chain is at a Prague-era fork
// and every Cancun opcode is available. See claude-docs/BOTCHAIN_FACTS.md.

/** `.env.example` ships empty placeholders, so treat "" as unset everywhere below. */
const env = (key: string, fallback: string): string => {
    const v = process.env[key];
    return v !== undefined && v.trim() !== "" ? v.trim() : fallback;
};

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";
const FLARE_RPC_API_KEY = process.env.FLARE_RPC_API_KEY ?? "";
const FLARE_EXPLORER_API_KEY = process.env.FLARE_EXPLORER_API_KEY ?? "";

const BOTCHAIN_EXPLORER_URL = env("BOTCHAIN_EXPLORER_URL", "https://scan.botchain.ai");
const BOTCHAIN_TESTNET_EXPLORER_URL = env("BOTCHAIN_TESTNET_EXPLORER_URL", "https://scan.bohr.life");
// Blockscout does not require a real key, but hardhat-verify refuses an empty string.
const BOTCHAIN_EXPLORER_API_KEY = env("BOTCHAIN_EXPLORER_API_KEY", "blockscout");

const COSTON_EXPLORER_URL = process.env.COSTON_EXPLORER_URL ?? "https://coston-explorer.flare.network";
const COSTON2_EXPLORER_URL = process.env.COSTON2_EXPLORER_URL ?? "https://coston2-explorer.flare.network";
const SONGBIRD_EXPLORER_URL = process.env.SONGBIRD_EXPLORER_URL ?? "https://songbird-explorer.flare.network";
const FLARE_EXPLORER_URL = process.env.FLARE_EXPLORER_URL ?? "https://flare-explorer.flare.network";

const config: HardhatUserConfig = {
    solidity: {
        compilers: [
            {
                version: "0.8.25",
                settings: {
                    evmVersion: "cancun",
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                },
            },
        ],
    },
    networks: {
        // Forking BOT Chain mainnet lets the fork tests exercise the REAL WBOT/USDT pool, the
        // real USDT contract and the real WBOT wrapper before anything is deployed for money.
        // Enabled only when FORK=1 so the ordinary unit suite stays offline and fast.
        hardhat:
            process.env.FORK === "1"
                ? {
                      forking: {
                          // Deliberately NOT BOTCHAIN_RPC_URL: that variable is also a supported
                          // override for the live deploy target, so reusing it would let a
                          // testnet endpoint be forked while `chainId: 677` below forges a
                          // mainnet identity over it — silently invalidating the fork tests.
                          url: env("FORK_RPC_URL", "https://rpc.botchain.ai"),
                          ...(process.env.FORK_BLOCK ? { blockNumber: Number(process.env.FORK_BLOCK) } : {}),
                      },
                      chainId: 677,
                      // Hardhat has no built-in hardfork history for chain 677 and refuses to
                      // execute against a forked block without one. BOT Chain is at a
                      // Prague-era fork, so every block in its history is at least Cancun.
                      // The node's own hardfork must be pinned too: it defaults to the newest
                      // Hardhat knows (osaka), which does not match anything in BOT Chain's
                      // history and leaves EDR unable to pick a fork for a historical block.
                      hardfork: "prague",
                      chains: { 677: { hardforkHistory: { prague: 0 } } },
                  }
                : {},

        // ─── BOT Chain — the deployment targets ──────────────────────────────
        botchain: {
            url: env("BOTCHAIN_RPC_URL", "https://rpc.botchain.ai"),
            accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
            chainId: 677,
        },
        botchainTestnet: {
            url: env("BOTCHAIN_TESTNET_RPC_URL", "https://rpc.bohr.life"),
            accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
            chainId: 968,
        },

        // ─── Flare (legacy — the pre-port deployment) ────────────────────────
        coston2: {
            url: FLARE_RPC_API_KEY
                ? `https://coston2-api-tracer.flare.network/ext/C/rpc?x-apikey=${FLARE_RPC_API_KEY}`
                : "https://coston2-api.flare.network/ext/C/rpc",
            accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
            chainId: 114,
        },
        coston: {
            url: FLARE_RPC_API_KEY
                ? `https://coston-api-tracer.flare.network/ext/C/rpc?x-apikey=${FLARE_RPC_API_KEY}`
                : "https://coston-api.flare.network/ext/C/rpc",
            accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
            chainId: 16,
        },
        songbird: {
            url: FLARE_RPC_API_KEY
                ? `https://songbird-api-tracer.flare.network/ext/C/rpc?x-apikey=${FLARE_RPC_API_KEY}`
                : "https://songbird-api.flare.network/ext/C/rpc",
            accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
            chainId: 19,
        },
        flare: {
            url: FLARE_RPC_API_KEY
                ? `https://flare-api-tracer.flare.network/ext/C/rpc?x-apikey=${FLARE_RPC_API_KEY}`
                : "https://flare-api.flare.network/ext/C/rpc",
            accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
            chainId: 14,
        },
    },
    etherscan: {
        apiKey: {
            // Blockscout ignores the value but requires it to be non-empty.
            botchain: BOTCHAIN_EXPLORER_API_KEY,
            botchainTestnet: BOTCHAIN_EXPLORER_API_KEY,
            coston: `${FLARE_EXPLORER_API_KEY}`,
            coston2: `${FLARE_EXPLORER_API_KEY}`,
            songbird: `${FLARE_EXPLORER_API_KEY}`,
            flare: `${FLARE_EXPLORER_API_KEY}`,
        },
        customChains: [
            {
                network: "botchain",
                chainId: 677,
                urls: {
                    apiURL: `${BOTCHAIN_EXPLORER_URL}/api`,
                    browserURL: BOTCHAIN_EXPLORER_URL,
                },
            },
            {
                network: "botchainTestnet",
                chainId: 968,
                urls: {
                    // faucet: https://faucet.botchain.ai/basic (10 tBOT / address / 24h)
                    apiURL: `${BOTCHAIN_TESTNET_EXPLORER_URL}/api`,
                    browserURL: BOTCHAIN_TESTNET_EXPLORER_URL,
                },
            },
            {
                network: "coston2",
                chainId: 114,
                urls: {
                    // faucet: https://faucet.flare.network/coston2
                    apiURL:
                        `${COSTON2_EXPLORER_URL}/api` +
                        (FLARE_EXPLORER_API_KEY ? `?x-apikey=${FLARE_EXPLORER_API_KEY}` : ""),
                    browserURL: COSTON2_EXPLORER_URL,
                },
            },
            {
                network: "coston",
                chainId: 16,
                urls: {
                    apiURL:
                        `${COSTON_EXPLORER_URL}/api` +
                        (FLARE_EXPLORER_API_KEY ? `?x-apikey=${FLARE_EXPLORER_API_KEY}` : ""),
                    browserURL: COSTON_EXPLORER_URL,
                },
            },
            {
                network: "songbird",
                chainId: 19,
                urls: {
                    apiURL:
                        `${SONGBIRD_EXPLORER_URL}/api` +
                        (FLARE_EXPLORER_API_KEY ? `?x-apikey=${FLARE_EXPLORER_API_KEY}` : ""),
                    browserURL: SONGBIRD_EXPLORER_URL,
                },
            },
            {
                network: "flare",
                chainId: 14,
                urls: {
                    apiURL:
                        `${FLARE_EXPLORER_URL}/api` +
                        (FLARE_EXPLORER_API_KEY ? `?x-apikey=${FLARE_EXPLORER_API_KEY}` : ""),
                    browserURL: FLARE_EXPLORER_URL,
                },
            },
        ],
    },
    paths: {
        sources: "./contracts/",
        tests: "./test/",
        cache: "./cache",
        artifacts: "./artifacts",
    },
    typechain: {
        target: "ethers-v6",
    },
};

export default config;
