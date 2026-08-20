"use client";

import { Suspense, use } from "react";
import Link from "next/link";
import {
  useAccount,
  useChainId,
  useReadContracts,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { maxUint256 } from "viem";
import {
  attestationAbi,
  controllerAbi,
  erc20Abi,
  registryAbi,
  settlementAbi,
  FUNDING_STATUS,
  REGISTRY_STATUS,
} from "@/lib/contracts";
import { DEPLOYMENT, SHARED } from "@/lib/books";
import { useBook } from "@/lib/use-book";
import { activeChain, addrUrl, txUrl } from "@/lib/chain";
import { amount, bpsToPct, dateOf, daysUntil, fromBytes32, shortHex } from "@/lib/format";
import { BookSwitcher } from "@/components/book-switcher";
import { RiskBadge } from "@/components/risk-badge";
import { StatusDot, invoiceState } from "@/components/status-dot";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<div className="mx-auto max-w-4xl px-4 py-10 sm:px-5">Loading…</div>}>
      <InvoiceDetail id={id as `0x${string}`} />
    </Suspense>
  );
}

function InvoiceDetail({ id }: { id: `0x${string}` }) {
  const [book, setBook] = useBook();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const wrongChain = isConnected && chainId !== activeChain.id;

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const { data, refetch } = useReadContracts({
    contracts: [
      { address: SHARED.registry, abi: registryAbi, functionName: "getInvoice", args: [id] },
      { address: SHARED.attestation, abi: attestationAbi, functionName: "gradeForInvoice", args: [id] },
      { address: book.controller, abi: controllerAbi, functionName: "fundingOf", args: [id] },
      { address: book.settlement, abi: settlementAbi, functionName: "amountDue", args: [id] },
      { address: book.settlement, abi: settlementAbi, functionName: "isDefaultable", args: [id] },
      { address: book.settlement, abi: settlementAbi, functionName: "defaultableAt", args: [id] },
      { address: book.asset, abi: erc20Abi, functionName: "allowance", args: [address ?? "0x0000000000000000000000000000000000000000", book.settlement] },
      { address: book.controller, abi: controllerAbi, functionName: "operator" },
    ],
    query: { refetchInterval: 8000 },
  });

  const reg = data?.[0]?.result as
    | { supplier: string; buyerCommitment: string; faceAmount: bigint; dueDate: bigint; status: number }
    | undefined;
  const grade = data?.[1]?.result as
    | { grade: string; riskScoreBps: number; discountRateBps: number; scorerSigner: string; modelVersion: string; imageDigest: string }
    | undefined;
  const funding = data?.[2]?.result as readonly [string, bigint, bigint, bigint, number] | undefined;
  const due = (data?.[3]?.result as bigint | undefined) ?? 0n;
  const defaultable = (data?.[4]?.result as boolean | undefined) ?? false;
  const defaultableAt = (data?.[5]?.result as bigint | undefined) ?? 0n;
  const allowance = (data?.[6]?.result as bigint | undefined) ?? 0n;
  const operator = data?.[7]?.result as string | undefined;

  if (!reg || reg.status === 0) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-5">
        <p className="text-sm text-muted-foreground">
          No invoice with id <span className="font-mono">{shortHex(id, 8)}</span>.{" "}
          <Link href="/marketplace" className="text-primary underline">
            Back to invoices
          </Link>
        </p>
      </div>
    );
  }

  const status = REGISTRY_STATUS[reg.status];
  const attested = Boolean(grade && grade.scorerSigner !== "0x0000000000000000000000000000000000000000");
  const fundingStatus = FUNDING_STATUS[funding?.[4] ?? 0];
  const dueDate = Number(reg.dueDate);
  const days = daysUntil(dueDate);
  const isOperator = Boolean(address && operator && address.toLowerCase() === operator.toLowerCase());
  const needsApproval = due > 0n && allowance < due;
  const after = () => setTimeout(() => void refetch(), 1500);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link href="/marketplace" className="text-xs text-muted-foreground hover:text-foreground">
            ← Invoices
          </Link>
          <h1 className="mt-2 break-all font-mono text-lg sm:text-xl">{id}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <StatusDot state={invoiceState(status, attested, dueDate)} />
            <span>due {dateOf(dueDate)}</span>
            <span>{days >= 0 ? `${days}d left` : `${-days}d overdue`}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <RiskBadge grade={attested ? fromBytes32(grade!.grade) : ""} />
          <BookSwitcher value={book} onChange={setBook} />
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle>Invoice</CardTitle>
          <dl className="mt-4 space-y-3 text-sm">
            <Row label="Face amount" value={`${amount(reg.faceAmount, book.decimals)} ${book.symbol}`} />
            <Row label="Supplier" value={<Ext href={addrUrl(reg.supplier)}>{shortHex(reg.supplier, 6)}</Ext>} />
            <Row
              label="Buyer"
              value={<span className="font-mono text-xs">{shortHex(reg.buyerCommitment, 6)}</span>}
              hint="A commitment hash. The buyer's identity is never published on-chain."
            />
            <Row label="Registry status" value={status} />
            <Row label="Funding ({book})" value={fundingStatus} />
            {funding && funding[4] !== 0 && (
              <Row label="Principal advanced" value={`${amount(funding[2], book.decimals)} ${book.symbol}`} />
            )}
          </dl>
        </Card>

        <Card>
          <CardTitle>Risk grade</CardTitle>
          {!attested ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Not yet scored. The scoring service grades the buyer off-chain and signs the result;
              only that signature and the grade reach the chain.
            </p>
          ) : (
            <dl className="mt-4 space-y-3 text-sm">
              <Row label="Grade" value={fromBytes32(grade!.grade)} />
              <Row label="Risk score" value={bpsToPct(grade!.riskScoreBps)} />
              <Row label="Discount rate" value={bpsToPct(grade!.discountRateBps)} />
              <Row label="Signed by" value={<Ext href={addrUrl(grade!.scorerSigner)}>{shortHex(grade!.scorerSigner, 6)}</Ext>} />
              <Row label="Model" value={fromBytes32(grade!.modelVersion) || "—"} />
              <Row
                label="Image digest"
                value={<span className="font-mono text-xs">{grade!.imageDigest === "0x" + "0".repeat(64) ? "unpinned build" : shortHex(grade!.imageDigest, 6)}</span>}
                hint="The container that produced this grade. Pull it, re-run the published model on the same inputs, and you get the same number."
              />
            </dl>
          )}
        </Card>
      </div>

      {/* Buyer actions */}
      {fundingStatus === "Outstanding" && (
        <Card className="mt-4">
          <CardTitle>Settle</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            The buyer repays face value in {book.symbol} and the contract observes the payment
            itself — no oracle, no proof, no reserve. Anyone may settle on the buyer&apos;s behalf.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex-1 rounded-xl border border-border bg-black/20 p-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Amount due</p>
              <p className="text-lg font-semibold tabular-nums">
                {amount(due, book.decimals)} {book.symbol}
              </p>
            </div>
            {wrongChain ? (
              <Button className="h-11" onClick={() => switchChain({ chainId: activeChain.id })}>
                Switch network
              </Button>
            ) : (
              <Button
                className="h-11"
                disabled={!isConnected || due === 0n || isPending || confirming}
                onClick={() => {
                  reset();
                  if (needsApproval) {
                    writeContract({ address: book.asset, abi: erc20Abi, functionName: "approve", args: [book.settlement, maxUint256] });
                  } else {
                    writeContract({ address: book.settlement, abi: settlementAbi, functionName: "payInvoice", args: [id] });
                  }
                  after();
                }}
              >
                {isPending || confirming ? "Confirming…" : needsApproval ? `Approve ${book.symbol}` : "Pay invoice"}
              </Button>
            )}
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              {defaultable
                ? "Past due plus the grace period. Anyone can now write this invoice off — the junior tranche absorbs the loss first."
                : `Can be defaulted from ${dateOf(defaultableAt)} (${DEPLOYMENT.gracePeriodDays}-day grace after the due date).`}
            </p>
            <Button
              variant="outline"
              className="mt-3 h-10"
              disabled={!isConnected || !defaultable || isPending || confirming || wrongChain}
              onClick={() => {
                reset();
                writeContract({ address: book.settlement, abi: settlementAbi, functionName: "markDefault", args: [id] });
                after();
              }}
            >
              Mark defaulted
            </Button>
          </div>
        </Card>
      )}

      {/* Operator action */}
      {status === "Registered" && attested && isOperator && (
        <Card className="mt-4">
          <CardTitle>Fund this invoice</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Advances face × (1 − discount) from the {book.label} pool to the supplier. Operator only.
          </p>
          <Button
            className="mt-4 h-11"
            disabled={isPending || confirming || wrongChain}
            onClick={() => {
              reset();
              writeContract({ address: book.controller, abi: controllerAbi, functionName: "fundInvoice", args: [id] });
              after();
            }}
          >
            {isPending || confirming ? "Confirming…" : "Fund"}
          </Button>
        </Card>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-[color:var(--destructive)]/40 bg-[color:var(--destructive)]/10 p-3 text-xs text-[color:var(--destructive)]">
          {(error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 200)}
        </p>
      )}
      {isSuccess && hash && (
        <p className="mt-4 text-xs text-[color:var(--success)]">
          Confirmed ·{" "}
          <a className="underline" href={txUrl(hash)} target="_blank" rel="noreferrer">
            view transaction
          </a>
        </p>
      )}
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right">
        <div className="font-medium tabular-nums">{value}</div>
        {hint && <p className="mt-0.5 max-w-[22rem] text-xs text-muted-foreground">{hint}</p>}
      </dd>
    </div>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="font-mono text-xs underline hover:text-primary">
      {children}
    </a>
  );
}
