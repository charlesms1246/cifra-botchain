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
