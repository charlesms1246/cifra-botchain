"use client";

import { useReadContracts } from "wagmi";
import { controllerAbi } from "@/lib/contracts";
import { BOOKS, DEPLOYMENT } from "@/lib/books";
import { amount } from "@/lib/format";
import { activeChain } from "@/lib/chain";

/**
 * Live figures read straight from the deployed contracts — proof the landing page is not static
 * marketing. Every number here is a value the chain currently holds; nothing is interpolated or
 * animated toward a target, because a count-up would be a claim the chain has not made.
 */
export function LiveStats() {
  const { data } = useReadContracts({
    contracts: BOOKS.map((b) => ({ chainId: activeChain.id, address: b.controller, abi: controllerAbi, functionName: "nav" as const })),
    query: { refetchInterval: 10000 },
  });

  const tiles = BOOKS.map((b, i) => ({
    v: amount((data?.[i]?.result as bigint | undefined) ?? 0n, b.decimals),
    l: `${b.label} vault NAV`,
    s: `senior + junior · ${b.symbol}`,
  }));

  tiles.push({
    v: `${DEPLOYMENT.gracePeriodDays}d`,
    l: "Grace period",
    s: "then anyone can default it — no oracle",
  });

  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-3">
      {tiles.map((t) => (
        <div key={t.l} className="rounded-2xl border border-border bg-black/20 p-5">
          <div className="text-2xl font-semibold tabular-nums text-primary">{t.v}</div>
          <div className="mt-1 font-medium">{t.l}</div>
          <div className="mt-0.5 text-sm text-muted-foreground">{t.s}</div>
        </div>
      ))}
      <p className="col-span-full text-xs text-muted-foreground">
        Live from {activeChain.name} · chain {activeChain.id}
      </p>
    </div>
  );
}
