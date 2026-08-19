// Per-network external addresses for Cifra on BOT Chain.
//
// ⚠️ THIS FILE EXISTS BECAUSE TESTNET IS NOT AN ADDRESS MIRROR OF MAINNET.
// The mainnet USDT address (0xaBab…7a3C) resolves to a DIFFERENT token, `WES`, on chain 968 —
// it has code and it answers ERC-20 calls, so hardcoding it would transact against the wrong
// contract with no error anywhere. There is deliberately no shared "addresses" constant in this
// codebase; everything external is looked up per chainId through `networkConfig()`.
// Verified 2026-08-20 by eth_getCode/symbol() against both chains. See
// claude-docs/BOTCHAIN_FACTS.md and claude-docs/ERRORS.md T7.

export type BookKey = "bot" | "usdt";

export type BookConfig = {
    /** Human label used in deployment output and share-token names. */
    label: string;
    /** ERC-20 the book is denominated in. For the BOT book this is WBOT, not native BOT. */
    asset: string;
    /** ERC-4626 share token names/symbols for the two tranches. */
    seniorName: string;
    seniorSymbol: string;
    juniorName: string;
    juniorSymbol: string;
    /**
     * DEX pool used purely to display NAV in a quote asset. `undefined` means no NAV oracle is
     * deployed for this book — correct for USDT, whose NAV already *is* the USD figure.
     */
    navPool?: string;
    /** Native-BOT wrap/unwrap helper is only meaningful for the wrapped-native book. */
    nativeHelper?: boolean;
};

export type NetworkConfig = {
    name: string;
    chainId: number;
    explorer: string;
    /** Canonical wrapped native token (WBOT). */
    wrappedNative: string;
    /** BDEX (Uniswap V3 fork) factory. */
    v3Factory: string;
    /**
     * Multicall3, when deployed. `undefined` on chain 968 — it genuinely is not deployed there,
     * which breaks wagmi's batch reads unless the frontend chain definition omits it too.
     */
    multicall3?: string;
    /** Safe singleton + proxy factory (1.4.1), when deployed. Absent on testnet. */
    safe?: { singleton: string; proxyFactory: string };
    books: Record<BookKey, BookConfig>;
};

/** TWAP window for the display-only NAV oracle. 30 min: a wide window costs nothing for a
 *  number that is never economically load-bearing, and makes moving it correspondingly dear. */
export const TWAP_WINDOW_SECONDS = 1800;

const BOOKS = (asset: { wbot: string; usdt: string }, navPool?: string): Record<BookKey, BookConfig> => ({
    bot: {
        label: "BOT",
        asset: asset.wbot,
        seniorName: "Cifra Senior BOT",
        seniorSymbol: "cBOT-S",
        juniorName: "Cifra Junior BOT",
        juniorSymbol: "cBOT-J",
        navPool,
        nativeHelper: true,
    },
    usdt: {
        label: "USDT",
        asset: asset.usdt,
        seniorName: "Cifra Senior USDT",
        seniorSymbol: "cUSDT-S",
        juniorName: "Cifra Junior USDT",
        juniorSymbol: "cUSDT-J",
        // No navPool: NAV in USDT is already the USD figure, so no oracle is deployed.
    },
});

export const NETWORKS: Record<number, NetworkConfig> = {
    // ─── BOT Chain mainnet ───────────────────────────────────────────────────────
    677: {
        name: "botchain",
        chainId: 677,
        explorer: "https://scan.botchain.ai",
        wrappedNative: "0xD5452816194a3784dBa983426cCe7c122F4abd30",
        v3Factory: "0x1C51c173323ec11BB4e3C4fD2314c225Dc4b5419",
        multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
        safe: {
            singleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
            proxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
        },
        books: BOOKS(
            {
                wbot: "0xD5452816194a3784dBa983426cCe7c122F4abd30",
                usdt: "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C", // 6dp, 289k holders
            },
            // Live WBOT/USDT 0.3% pool, observationCardinality 1024 — TWAP-ready today.
            "0x64f418471a1a7932a190e10da5a8551db5abec05"
        ),
    },

    // ─── BOT Chain testnet ───────────────────────────────────────────────────────
    // RPC https://rpc.bohr.life · explorer https://scan.bohr.life · faucet 10 tBOT/24h.
    968: {
        name: "botchainTestnet",
        chainId: 968,
        explorer: "https://scan.bohr.life",
        wrappedNative: "0xD5452816194a3784dBa983426cCe7c122F4abd30", // same address as mainnet
        v3Factory: "0x1C51c173323ec11BB4e3C4fD2314c225Dc4b5419", // same address as mainnet
        // Multicall3 is NOT deployed on 968 (verified) — leave undefined so callers fall back
        // to individual eth_calls instead of reverting.
        multicall3: undefined,
        // Safe is NOT deployed on 968 (verified). Governance can only be exercised on mainnet
        // unless Safe is deployed here manually (the CREATE2 deployer is present).
        safe: undefined,
        books: BOOKS({
            wbot: "0xD5452816194a3784dBa983426cCe7c122F4abd30",
            // ⚠️ NOT the mainnet USDT address — that one is a token called `WES` here.
            usdt: "0xa00D072A5A060f48Aa2aF79700a1FaA4140141c6", // 6dp
        }),
        // No navPool on testnet: there is no meaningful WBOT/USDT liquidity to price against,
        // so the BOT book deploys without a NAV oracle and the UI shows NAV in BOT only.
    },
};

/** Look up a network's config, failing loudly rather than silently using the wrong chain. */
export function networkConfig(chainId: number): NetworkConfig {
    const cfg = NETWORKS[chainId];
    if (!cfg) {
        throw new Error(
            `No Cifra network config for chainId ${chainId}. ` +
                `Known: ${Object.keys(NETWORKS).join(", ")}. Add it to config/networks.ts — ` +
                `do not reuse another chain's addresses.`
        );
    }
    return cfg;
}

export const isLocalChain = (chainId: number) => chainId === 31337 || chainId === 1337;
