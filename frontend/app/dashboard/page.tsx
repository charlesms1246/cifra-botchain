"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, useSwitchChain, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits, formatUnits } from "viem";
import { CONTRACTS, TRANCHES, navOracleAbi, vaultAbi, controllerAbi, erc20Abi, FXRP_DECIMALS } from "@/lib/contracts";
import { coston2 } from "@/lib/chain";
import { usd, amount } from "@/lib/format";
import { StatCard } from "@/components/stat-card";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const controller = { address: CONTRACTS.controller as `0x${string}`, abi: controllerAbi } as const;
const seniorNav = { address: CONTRACTS.seniorNavOracle as `0x${string}`, abi: navOracleAbi } as const;
const juniorNav = { address: CONTRACTS.juniorNavOracle as `0x${string}`, abi: navOracleAbi } as const;

export default function Dashboard() {
  const { data } = useReadContracts({
    contracts: [
      { ...controller, functionName: "nav" },
      { ...controller, functionName: "totalDeployed" },
      { ...controller, functionName: "paused" },
      { ...controller, functionName: "seniorYieldShareBps" },
      { ...seniorNav, functionName: "navUsd" },
      { ...seniorNav, functionName: "xrpUsdPrice" },
      { ...juniorNav, functionName: "navUsd" },
    ],
    query: { refetchInterval: 8000 },
  });

  const navFxrp = (data?.[0]?.result as bigint | undefined) ?? 0n;
  const totalDeployed = (data?.[1]?.result as bigint | undefined) ?? 0n;
  const paused = (data?.[2]?.result as boolean | undefined) ?? false;
  const seniorShareBps = (data?.[3]?.result as bigint | undefined) ?? 5000n;
  const seniorNavUsd = (data?.[4]?.result as [bigint, bigint] | undefined)?.[0] ?? 0n;
  const xrpPrice = (data?.[5]?.result as [bigint, bigint] | undefined)?.[0] ?? 0n;
  const juniorNavUsd = (data?.[6]?.result as [bigint, bigint] | undefined)?.[0] ?? 0n;

  const totalNavUsd = seniorNavUsd + juniorNavUsd;
  const utilization = navFxrp > 0n ? Number((totalDeployed * 10000n) / navFxrp) / 100 : 0;
  const seniorPct = Number(seniorShareBps) / 100;

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Funder vault</h1>
          <p className="mt-1 text-muted-foreground">
            Two tranches over one FXRP pool: senior is protected, junior takes first loss for more yield.
            Each invoice&apos;s discount spread is split {seniorPct}/{100 - seniorPct} senior/junior; NAV priced in USD via the FTSO XRP/USD feed.
          </p>
        </div>
        {paused && <Badge className="text-[color:var(--warning)] border-[color:var(--warning)]/40">deposits paused</Badge>}
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard accent label="Total NAV (USD)" value={usd(totalNavUsd)} sub={`${amount(navFxrp, FXRP_DECIMALS)} FXRP · via FTSO`} />
        <StatCard label="XRP / USD" value={usd(xrpPrice)} sub="live FTSO block-latency feed" />
        <StatCard label="Deployed" value={`${amount(totalDeployed, FXRP_DECIMALS)}`} sub={`${utilization}% utilization`} />
        <StatCard label="Yield split" value={`${seniorPct} / ${100 - seniorPct}`} sub="senior / junior of each spread" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {TRANCHES.map((t) => (
          <TranchePanel key={t.key} tranche={t} paused={paused} xrpPrice={xrpPrice} />
        ))}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-t border-border pt-2">
      <span className="text-muted-foreground">{k}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
}

function TranchePanel({
  tranche,
  paused,
  xrpPrice,
}: {
  tranche: (typeof TRANCHES)[number];
  paused: boolean;
  xrpPrice: bigint;
}) {
  const { address, isConnected } = useAccount();
  const vault = { address: tranche.vault as `0x${string}`, abi: vaultAbi } as const;
  const nav = { address: tranche.navOracle as `0x${string}`, abi: navOracleAbi } as const;
  const zero = "0x0000000000000000000000000000000000000000" as const;

  const { data, refetch } = useReadContracts({
    contracts: [
      { ...nav, functionName: "navUsd" },
      { ...nav, functionName: "pricePerShareUsd" },
      { ...vault, functionName: "totalAssets" },
      { ...vault, functionName: "balanceOf", args: [address ?? zero] },
      { address: CONTRACTS.fxrp as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [address ?? zero] },
    ],
    query: { refetchInterval: 8000 },
  });

  const trancheNavUsd = (data?.[0]?.result as [bigint, bigint] | undefined)?.[0] ?? 0n;
  const pps = (data?.[1]?.result as [bigint, bigint] | undefined)?.[0] ?? 0n;
  const trancheAssets = (data?.[2]?.result as bigint | undefined) ?? 0n;
  const shares = (data?.[3]?.result as bigint | undefined) ?? 0n;
  const fxrpBal = (data?.[4]?.result as bigint | undefined) ?? 0n;

  const { data: posAssets } = useReadContracts({
    contracts: [{ ...vault, functionName: "convertToAssets", args: [shares] }],
    query: { enabled: shares > 0n },
  });
  const positionFxrp = (posAssets?.[0]?.result as bigint | undefined) ?? 0n;
  const positionUsd = (positionFxrp * xrpPrice) / 10n ** BigInt(FXRP_DECIMALS);

  return (
    <Card className={tranche.accent ? "border-primary/40" : undefined}>
      <div className="flex items-center justify-between">
        <CardTitle>{tranche.label} tranche</CardTitle>
        <Badge className={tranche.accent ? "border-primary/40 text-primary" : undefined}>
          {tranche.accent ? "first-loss" : "protected"}
        </Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{tranche.blurb}</p>

      <div className="mt-4 flex items-end justify-between">
        <div>
          <div className="text-3xl font-semibold tabular-nums">{usd(trancheNavUsd)}</div>
          <div className="mt-1 text-sm text-muted-foreground">{amount(trancheAssets, FXRP_DECIMALS)} FXRP · {usd(pps)}/share</div>
        </div>
      </div>

      {isConnected && shares > 0n && (
        <div className="mt-4 space-y-2 text-sm">
          <Row k="Your position" v={`${usd(positionUsd)} · ${amount(positionFxrp, FXRP_DECIMALS)} FXRP`} />
          <Row k="Your shares" v={`${amount(shares, 9)} ${tranche.key === "senior" ? "cFXRP-S" : "cFXRP-J"}`} />
        </div>
      )}

      <div className="mt-5">
        <DepositCard vault={tranche.vault} fxrpBal={fxrpBal} paused={paused} isConnected={isConnected} onDone={() => refetch()} />
      </div>
    </Card>
  );
}

function DepositCard({
  vault: vaultAddr,
  fxrpBal,
  paused,
  isConnected,
  onDone,
}: {
  vault: string;
  fxrpBal: bigint;
  paused: boolean;
  isConnected: boolean;
  onDone: () => void;
}) {
  const { address } = useAccount();
  const [input, setInput] = useState("");
  const parsed = useMemo(() => {
    try {
      return input ? parseUnits(input, FXRP_DECIMALS) : 0n;
    } catch {
      return 0n;
    }
  }, [input]);

  const { data: allowanceData } = useReadContracts({
    contracts: [
      {
        address: CONTRACTS.fxrp as `0x${string}`,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address ?? "0x0000000000000000000000000000000000000000", vaultAddr as `0x${string}`],
      },
    ],
    query: { enabled: isConnected, refetchInterval: 5000 },
  });
  const allowance = (allowanceData?.[0]?.result as bigint | undefined) ?? 0n;
  const needsApprove = parsed > allowance;

  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const wrongChain = isConnected && chainId !== coston2.id;
  const { writeContract, data: hash, isPending, reset } = useWriteContract();
  const { isLoading: mining, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) onDone();
  }, [isSuccess, onDone]);

  const disabled = !isConnected || (!wrongChain && (paused || parsed === 0n || parsed > fxrpBal || isPending || mining));

  function onClick() {
    if (wrongChain) {
      switchChain({ chainId: coston2.id });
    } else if (needsApprove) {
      writeContract({
        address: CONTRACTS.fxrp as `0x${string}`,
        abi: erc20Abi,
        functionName: "approve",
        args: [vaultAddr as `0x${string}`, parsed],
        chainId: coston2.id,
      });
    } else {
      writeContract(
        { address: vaultAddr as `0x${string}`, abi: vaultAbi, functionName: "deposit", args: [parsed, address!], chainId: coston2.id },
        { onSuccess: () => reset() }
      );
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 rounded-xl border border-input bg-black/20 px-4 py-3">
        <input
          inputMode="decimal"
          placeholder="0.0"
          value={input}
          onChange={(e) => setInput(e.target.value.replace(/[^0-9.]/g, ""))}
          className="w-full bg-transparent text-2xl font-medium tabular-nums outline-none placeholder:text-muted-foreground/50"
        />
        <span className="text-sm text-muted-foreground">FXRP</span>
        <button
          onClick={() => setInput(formatUnits(fxrpBal, FXRP_DECIMALS))}
          className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Max
        </button>
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>Balance: {amount(fxrpBal, FXRP_DECIMALS)} FXRP</span>
        {parsed > fxrpBal && <span className="text-[color:var(--destructive)]">Insufficient balance</span>}
      </div>
      <Button className="mt-4 w-full" disabled={disabled} onClick={onClick}>
        {!isConnected
          ? "Connect wallet"
          : wrongChain
          ? "Switch to Coston2"
          : paused
          ? "Deposits paused"
          : isPending || mining
          ? "Confirming…"
          : needsApprove
          ? "Approve FXRP"
          : "Deposit"}
      </Button>
    </div>
  );
}
