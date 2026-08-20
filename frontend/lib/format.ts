import { formatUnits } from "viem";

export const shortHex = (s: string, n = 4) =>
  s.length > 2 * n + 2 ? `${s.slice(0, n + 2)}…${s.slice(-n)}` : s;

/** 18-dp USD (wei) -> "$1,234.56" */
export function usd(weiValue: bigint, max = 2): string {
  const n = Number(formatUnits(weiValue, 18));
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: max });
}

/** token amount -> compact string */
export function amount(value: bigint, decimals: number, max = 4): string {
  const n = Number(formatUnits(value, decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}

export const bpsToPct = (bps: number | bigint) => `${Number(bps) / 100}%`;

/** Tick -> price, the conversion CifraNavOracle deliberately does NOT do on-chain (Uniswap's
 *  TickMath is GPL-2.0-or-later and would infect this MIT codebase). Display only. */
export function priceFromTick(tick: number, baseIsToken0: boolean, baseDecimals: number, quoteDecimals: number): number {
  // Ticks are always token1-per-token0; invert when the base asset is token1.
  const raw = Math.pow(1.0001, baseIsToken0 ? tick : -tick);
  return raw * Math.pow(10, (baseIsToken0 ? baseDecimals - quoteDecimals : quoteDecimals - baseDecimals));
}

/** Seconds-since-epoch -> "12 Mar 2027" */
export const dateOf = (unix: number | bigint) =>
  new Date(Number(unix) * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Whole days from now until `unix`; negative once past. */
export const daysUntil = (unix: number | bigint) =>
  Math.ceil((Number(unix) * 1000 - Date.now()) / 86_400_000);

/** bytes32 -> trimmed ASCII, for on-chain short strings like grades and model versions. */
export function fromBytes32(hex: string): string {
  if (!hex || hex === "0x") return "";
  const bytes = hex.slice(2).match(/.{2}/g) ?? [];
  return bytes
    .map((b) => parseInt(b, 16))
    .filter((c) => c !== 0)
    .map((c) => String.fromCharCode(c))
    .join("");
}
