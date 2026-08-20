// Tick → price conversion. The single implementation, shared with the Hardhat suite.
//
// It lives HERE rather than at the repo root because Next's module graph is rooted at
// `frontend/` and cannot import from outside it. The dependency therefore runs one way: the
// tests import this file, never the reverse. That still gives the property that matters — the
// tests exercise the code the app actually ships, rather than a copy of the formula, which
// cannot fail when the shipped code regresses.

/**
 * Convert a Uniswap V3 mean tick into a human quote-per-base price.
 *
 * `CifraNavOracle` deliberately does not do this on-chain: Uniswap's TickMath is
 * GPL-2.0-or-later and would infect this MIT codebase. The result is display-only.
 *
 * A tick encodes RAW token1 per RAW token0, so two separate adjustments are needed and it is
 * easy to conflate them:
 *
 *   - the TICK SIGN flips when the base asset is token1 (we want base priced in quote), but
 *   - the DECIMAL EXPONENT is always `baseDecimals - quoteDecimals`, whichever side base is on.
 *
 * Flipping the exponent along with the sign rescales the answer by
 * 10^(2·(baseDecimals−quoteDecimals)) — a factor of 10^24 on the real WBOT(18)/USDT(6) pool.
 * That bug shipped once and was caught only by the mainnet-fork test.
 */
export function priceFromTick(
    tick: number,
    baseIsToken0: boolean,
    baseDecimals: number,
    quoteDecimals: number
): number {
    const raw = Math.pow(1.0001, baseIsToken0 ? tick : -tick);
    return raw * Math.pow(10, baseDecimals - quoteDecimals);
}
