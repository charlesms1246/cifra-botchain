import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

// Derived from flare-foundation/flare-hardhat-starter. Kept faithful to the
// starter's Solidity settings and Flare network blocks (Coston2 primary), but
// trimmed to a focused, standard toolchain (hardhat-toolbox / ethers v6). See
// README "Toolchain" for the deliberate deviations.

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";
const FLARE_RPC_API_KEY = process.env.FLARE_RPC_API_KEY ?? "";
const FLARE_EXPLORER_API_KEY = process.env.FLARE_EXPLORER_API_KEY ?? "";

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
        // Coston2 is Cifra's primary target (see CLAUDE.md network config).
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
            coston: `${FLARE_EXPLORER_API_KEY}`,
            coston2: `${FLARE_EXPLORER_API_KEY}`,
            songbird: `${FLARE_EXPLORER_API_KEY}`,
            flare: `${FLARE_EXPLORER_API_KEY}`,
        },
        customChains: [
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
