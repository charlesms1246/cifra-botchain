"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useReadContracts } from "wagmi";
import { attestationAbi, controllerAbi, registryAbi, REGISTRY_STATUS } from "@/lib/contracts";
import { SHARED } from "@/lib/books";
import { useBook } from "@/lib/use-book";
import { fetchRegisteredInvoices, type ChainInvoice } from "@/lib/invoices";
import { activeChain } from "@/lib/chain";
import { amount, bpsToPct, dateOf, daysUntil, fromBytes32, shortHex } from "@/lib/format";
import { BookSwitcher } from "@/components/book-switcher";
import { RiskBadge } from "@/components/risk-badge";
import { StatusDot, invoiceState } from "@/components/status-dot";
import { Card } from "@/components/ui/card";

export default function MarketplacePage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-10 sm:px-5">Loading…</div>}>
      <Marketplace />
    </Suspense>
  );
}

function Marketplace() {
  const [book, setBook] = useBook();
  const [invoices, setInvoices] = useState<ChainInvoice[] | null>(null);

  useEffect(() => {
    let live = true;
    fetchRegisteredInvoices()
      .then((r) => live && setInvoices(r))
      .catch(() => live && setInvoices([]));
    return () => {
      live = false;
    };
  }, []);

  const ids = useMemo(() => (invoices ?? []).map((i) => i.id), [invoices]);

  // The registry is shared across books, so the funding record has to come from each book's own
  // controller — an invoice funded from the USDT book is simply absent from the BOT controller.
  const { data } = useReadContracts({
    contracts: ids.flatMap((id) => [
      { chainId: activeChain.id, address: SHARED.registry, abi: registryAbi, functionName: "getInvoice", args: [id] } as const,
      { chainId: activeChain.id, address: SHARED.attestation, abi: attestationAbi, functionName: "gradeForInvoice", args: [id] } as const,
      { chainId: activeChain.id, address: book.controller, abi: controllerAbi, functionName: "fundingOf", args: [id] } as const,
    ]),
    query: { enabled: ids.length > 0, refetchInterval: 10000 },
  });

  const rows = (invoices ?? []).map((inv, i) => {
    const reg = data?.[i * 3]?.result as { faceAmount: bigint; dueDate: bigint; status: number } | undefined;
    const grade = data?.[i * 3 + 1]?.result as
      | { grade: string; riskScoreBps: number; discountRateBps: number; scorerSigner: string; modelVersion: string }
      | undefined;
    const funding = data?.[i * 3 + 2]?.result as readonly [string, bigint, bigint, bigint, number] | undefined;

    const status = REGISTRY_STATUS[reg?.status ?? 0] ?? "None";
    const attested = Boolean(grade && grade.scorerSigner !== "0x0000000000000000000000000000000000000000");
    const fundedInThisBook = Boolean(funding && funding[4] !== 0);

    return { inv, reg, grade, status, attested, fundedInThisBook, dueDate: Number(reg?.dueDate ?? inv.dueDate) };
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Invoices</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Every registered invoice on-chain. The buyer is an opaque commitment hash — their
            identity and payment history are never published. Funders see the signed grade only.
          </p>
        </div>
        <BookSwitcher value={book} onChange={setBook} />
      </div>

      {invoices === null && <p className="mt-8 text-sm text-muted-foreground">Reading the registry…</p>}
      {invoices?.length === 0 && (
        <Card className="mt-8">
          <p className="text-sm text-muted-foreground">
            No invoices registered yet.{" "}
            <Link href="/onboard" className="text-primary underline">
              Factor one
            </Link>{" "}
            to see it here.
          </p>
        </Card>
      )}

      <div className="mt-6 space-y-3">
        {rows.map(({ inv, reg, grade, status, attested, fundedInThisBook, dueDate }) => {
          const face = reg?.faceAmount ?? inv.faceAmount;
          const days = daysUntil(dueDate);
          return (
            <Link key={inv.id} href={`/invoice/${inv.id}`} className="block">
              <Card className="transition-colors hover:border-primary/40">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <RiskBadge grade={attested ? fromBytes32(grade!.grade) : ""} />
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm">{shortHex(inv.id, 8)}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <StatusDot state={invoiceState(status, attested, dueDate)} />
                        <span>due {dateOf(dueDate)}</span>
                        <span>{days >= 0 ? `${days}d left` : `${-days}d overdue`}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 sm:justify-end">
                    <div className="text-right">
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Face</p>
                      <p className="font-semibold tabular-nums">
                        {amount(face, book.decimals)} {book.symbol}
                      </p>
                    </div>
                    {attested && (
                      <div className="text-right">
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Discount</p>
                        <p className="font-semibold tabular-nums">{bpsToPct(grade!.discountRateBps)}</p>
                      </div>
                    )}
                    {fundedInThisBook && (
                      <span className="rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">
                        {book.symbol} book
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      <p className="mt-8 text-xs text-muted-foreground">
        Face amounts are shown in {book.symbol} because you are viewing the {book.label} book. An
        invoice is faced, funded and repaid in one asset and the protocol never converts between
        them — switch books if an amount looks wrong.
      </p>
    </div>
  );
}
