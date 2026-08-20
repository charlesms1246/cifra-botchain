"use client";

import { Suspense, useMemo, useState } from "react";
import {
  useAccount,
  useBalance,
  useChainId,
  useReadContracts,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { parseUnits, maxUint256 } from "viem";
import { controllerAbi, erc20Abi, nativeHelperAbi, navOracleAbi, vaultAbi } from "@/lib/contracts";
import { tranches, type Book } from "@/lib/books";
import { useBook } from "@/lib/use-book";
import { activeChain, txUrl } from "@/lib/chain";
import { amount, priceFromTick } from "@/lib/format";
import { BookSwitcher } from "@/components/book-switcher";
import { StatCard } from "@/components/stat-card";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-10 sm:px-5">Loading…</div>}>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const [book, setBook] = useBook();

  const controller = { address: book.controller, abi: controllerAbi } as const;
  const { data } = useReadContracts({
    contracts: [
      { ...controller, functionName: "nav" },
      { ...controller, functionName: "totalDeployed" },
      { ...controller, functionName: "paused" },
      { ...controller, functionName: "seniorYieldShareBps" },
      { ...controller, functionName: "claimOf", args: [book.seniorVault] },
      { ...controller, functionName: "claimOf", args: [book.juniorVault] },
    ],
    query: { refetchInterval: 8000 },
  });

  // Kept as its own call: mixing a second ABI into the array above collapses wagmi's inferred
  // function-name union to the intersection, and every entry fails to type-check.
  const { data: oracle } = useReadContracts({
    contracts: [{ address: book.navOracle ?? "0x", abi: navOracleAbi, functionName: "quote" }],
    query: { enabled: Boolean(book.navOracle), refetchInterval: 30000 },
  });

  const nav = (data?.[0]?.result as bigint | undefined) ?? 0n;
  const deployed = (data?.[1]?.result as bigint | undefined) ?? 0n;
  const paused = (data?.[2]?.result as boolean | undefined) ?? false;
  const seniorShareBps = (data?.[3]?.result as bigint | undefined) ?? 5000n;
  const seniorClaim = (data?.[4]?.result as bigint | undefined) ?? 0n;
  const juniorClaim = (data?.[5]?.result as bigint | undefined) ?? 0n;
  const quote = oracle?.[0]?.result as
    | readonly [bigint, bigint, number, boolean, boolean, number, number]
    | undefined;

  const utilization = nav > 0n ? Number((deployed * 10000n) / nav) / 100 : 0;
  const seniorPct = Number(seniorShareBps) / 100;

  // Display-only USD figure. Absent for the USDT book (NAV already is the USD figure) and
  // absent on testnet, where there is no pool with meaningful liquidity to price against.
  const usdNav = useMemo(() => {
    if (!book.navOracle) return null;
    if (!quote || !quote[3]) return null;
    const price = priceFromTick(Number(quote[2]), quote[4], quote[5], quote[6]);
    return (Number(nav) / 10 ** book.decimals) * price;
  }, [book, quote, nav]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Funder vault</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Two tranches over one {book.symbol} pool: senior is protected, junior takes first loss for more
            yield. Each invoice&apos;s discount spread is split {seniorPct}/{100 - seniorPct} senior/junior.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {paused && <Badge className="border-[color:var(--warning)]/40 text-[color:var(--warning)]">deposits paused</Badge>}
          <BookSwitcher value={book} onChange={setBook} />
        </div>
      </div>

      <p className="mt-4 rounded-xl border border-border bg-black/20 p-3 text-xs text-muted-foreground">
        {book.blurb} Books never mix — no price oracle is consulted on any path where money moves.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          accent
          label={`Total NAV (${book.symbol})`}
          value={amount(nav, book.decimals)}
          sub={usdNav !== null ? `≈ $${usdNav.toLocaleString(undefined, { maximumFractionDigits: 2 })} · 30m TWAP, display only` : "senior + junior claims"}
        />
        <StatCard label="Senior claim" value={amount(seniorClaim, book.decimals)} sub={`${seniorPct}% of each spread`} />
        <StatCard label="Junior claim" value={amount(juniorClaim, book.decimals)} sub="first loss · residual yield" />
        <StatCard label="Deployed" value={amount(deployed, book.decimals)} sub={`${utilization}% utilization`} />
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        {tranches(book).map((t) => (
          <TrancheCard key={t.key} book={book} tranche={t} paused={paused} />
        ))}
      </div>
    </div>
  );
}

function TrancheCard({
  book,
  tranche,
  paused,
}: {
  book: Book;
  tranche: ReturnType<typeof tranches>[number];
  paused: boolean;
}) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const wrongChain = isConnected && chainId !== activeChain.id;

  const [value, setValue] = useState("");
  // Native BOT deposits route through the helper (wrap + deposit in one transaction). For USDT
  // the funder approves the vault directly.
  const [useNative, setUseNative] = useState(book.isNative);

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const { data: nativeBal } = useBalance({ address, query: { enabled: Boolean(address) } });
  const { data: reads } = useReadContracts({
    contracts: [
      { address: tranche.vault, abi: vaultAbi, functionName: "totalAssets" },
      { address: tranche.vault, abi: vaultAbi, functionName: "balanceOf", args: [address ?? "0x0000000000000000000000000000000000000000"] },
      { address: tranche.vault, abi: vaultAbi, functionName: "decimals" },
      { address: tranche.vault, abi: vaultAbi, functionName: "symbol" },
      { address: book.asset, abi: erc20Abi, functionName: "balanceOf", args: [address ?? "0x0000000000000000000000000000000000000000"] },
      { address: book.asset, abi: erc20Abi, functionName: "allowance", args: [address ?? "0x0000000000000000000000000000000000000000", tranche.vault] },
    ],
    query: { enabled: Boolean(address), refetchInterval: 8000 },
  });

  const totalAssets = (reads?.[0]?.result as bigint | undefined) ?? 0n;
  const shares = (reads?.[1]?.result as bigint | undefined) ?? 0n;
  const shareDecimals = (reads?.[2]?.result as number | undefined) ?? book.decimals + 3;
  const shareSymbol = (reads?.[3]?.result as string | undefined) ?? "";
  const walletAsset = (reads?.[4]?.result as bigint | undefined) ?? 0n;
  const allowance = (reads?.[5]?.result as bigint | undefined) ?? 0n;

  const parsed = value.trim() === "" ? 0n : safeParse(value, book.decimals);
  const needsApproval = !useNative && parsed > 0n && allowance < parsed;
  const spendable = useNative ? (nativeBal?.value ?? 0n) : walletAsset;
  const insufficient = parsed > 0n && parsed > spendable;

  const submit = () => {
    reset();
    if (parsed <= 0n) return;
    if (useNative && book.nativeDepositHelper) {
      writeContract({
        address: book.nativeDepositHelper,
        abi: nativeHelperAbi,
        functionName: "depositNative",
        args: [tranche.vault, address!],
        value: parsed,
      });
      return;
    }
    if (needsApproval) {
      writeContract({ address: book.asset, abi: erc20Abi, functionName: "approve", args: [tranche.vault, maxUint256] });
      return;
    }
    writeContract({ address: tranche.vault, abi: vaultAbi, functionName: "deposit", args: [parsed, address!] });
  };

  return (
    <Card className={tranche.accent ? "border-primary/30" : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <CardTitle>
            {tranche.label} · {book.symbol}
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{tranche.blurb}</p>
        </div>
        {tranche.accent && <Badge>first loss</Badge>}
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Tranche NAV</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {amount(totalAssets, book.decimals)} {book.symbol}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Your shares</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {amount(shares, shareDecimals)} {shareSymbol}
          </dd>
        </div>
      </dl>

      <div className="mt-5 space-y-3">
        {book.isNative && (
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setUseNative(true)}
              className={`rounded-full px-3 py-1 font-semibold ${useNative ? "bg-white/[0.08] text-foreground" : "text-muted-foreground"}`}
            >
              Native BOT
            </button>
            <button
              onClick={() => setUseNative(false)}
              className={`rounded-full px-3 py-1 font-semibold ${!useNative ? "bg-white/[0.08] text-foreground" : "text-muted-foreground"}`}
            >
              WBOT
            </button>
            <span className="text-muted-foreground">
              {useNative ? "wrapped and deposited in one transaction" : "already-wrapped balance"}
            </span>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <input
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.00"
              className="h-11 w-full rounded-xl border border-border bg-black/20 px-3 pr-16 text-sm tabular-nums outline-none focus:border-primary/60"
              aria-label={`Amount to deposit into ${tranche.label}`}
            />
            <button
              onClick={() => setValue(formatMax(spendable, book.decimals))}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              MAX
            </button>
          </div>
          {wrongChain ? (
            <Button className="h-11" onClick={() => switchChain({ chainId: activeChain.id })}>
              Switch network
            </Button>
          ) : (
            <Button
              className="h-11"
              onClick={submit}
              disabled={!isConnected || paused || parsed <= 0n || insufficient || isPending || confirming}
            >
              {isPending || confirming ? "Confirming…" : needsApproval ? "Approve" : "Deposit"}
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Balance {amount(spendable, book.decimals)} {useNative ? activeChain.nativeCurrency.symbol : book.symbol}
          {insufficient && <span className="ml-2 text-[color:var(--destructive)]">insufficient balance</span>}
        </p>

        {error && (
          <p className="rounded-lg border border-[color:var(--destructive)]/40 bg-[color:var(--destructive)]/10 p-2 text-xs text-[color:var(--destructive)]">
            {shortError(error)}
          </p>
        )}
        {isSuccess && hash && (
          <p className="text-xs text-[color:var(--success)]">
            Confirmed ·{" "}
            <a className="underline" href={txUrl(hash)} target="_blank" rel="noreferrer">
              view transaction
            </a>
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Withdrawals are bounded by idle pool liquidity — capital advanced to invoices cannot be
          pulled until it returns.
        </p>
      </div>
    </Card>
  );
}

function safeParse(v: string, decimals: number): bigint {
  try {
    return parseUnits(v, decimals);
  } catch {
    return 0n;
  }
}

function formatMax(v: bigint, decimals: number): string {
  const s = (Number(v) / 10 ** decimals).toFixed(Math.min(6, decimals));
  return s.replace(/\.?0+$/, "");
}

/** Wallet errors are enormous; surface the first meaningful line only. */
function shortError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.split("\n")[0].slice(0, 160);
}
