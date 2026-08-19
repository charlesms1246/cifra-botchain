"use client";

import { useReadContracts } from "wagmi";
import { CONTRACTS, navOracleAbi } from "@/lib/contracts";
import { coston2 } from "@/lib/chain";
import { usd } from "@/lib/format";

const sNav = { address: CONTRACTS.seniorNavOracle as `0x${string}`, abi: navOracleAbi } as const;
const jNav = { address: CONTRACTS.juniorNavOracle as `0x${string}`, abi: navOracleAbi } as const;

// Live on-chain figures read straight from the deployed Coston2 contracts — proof the landing
// isn't static marketing: the NAV and price update from the FTSO feed every few seconds.
export function LiveStats() {
  const { data } = useReadContracts({
    contracts: [
      { ...sNav, functionName: "navUsd", chainId: coston2.id },
      { ...jNav, functionName: "navUsd", chainId: coston2.id },
      { ...sNav, functionName: "xrpUsdPrice", chainId: coston2.id },
    ],
    query: { refetchInterval: 10000 },
  });
  const s = (data?.[0]?.result as [bigint, bigint] | undefined)?.[0] ?? 0n;
  const j = (data?.[1]?.result as [bigint, bigint] | undefined)?.[0] ?? 0n;
  const xrp = (data?.[2]?.result as [bigint, bigint] | undefined)?.[0] ?? 0n;

  const tiles = [
    { v: usd(s + j), l: "Vault NAV (USD)", s: "senior + junior · live via FTSO" },
    { v: usd(xrp), l: "XRP / USD", s: "FTSO block-latency feed" },
    { v: "2-of-3", l: "Safe governance", s: "no single key can change params" },
  ];
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-3">
      {tiles.map((t) => (
        <div key={t.l} className="rounded-2xl border border-border bg-black/20 p-5">
          <div className="text-2xl font-semibold tabular-nums text-primary">{t.v}</div>
          <div className="mt-1 font-medium">{t.l}</div>
          <div className="mt-0.5 text-sm text-muted-foreground">{t.s}</div>
        </div>
      ))}
    </div>
  );
}
