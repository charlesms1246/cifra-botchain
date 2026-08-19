"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { hexToString } from "viem";
import {
  CONTRACTS,
  registryAbi,
  attestationAbi,
  jurisdictionOracleAbi,
  REGISTRY_STATUS,
  FXRP_DECIMALS,
} from "@/lib/contracts";
import { fetchRegisteredInvoices, type ChainInvoice } from "@/lib/invoices";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RiskBadge } from "@/components/risk-badge";
import { bpsToPct, shortHex, amount } from "@/lib/format";
import { ShieldCheck } from "lucide-react";

type Status = (typeof REGISTRY_STATUS)[number];
const STATUS_STYLES: Record<string, string> = {
  Registered: "text-muted-foreground",
  Funded: "text-primary border-primary/40 bg-primary/10",
  Settled: "text-[color:var(--success)] border-[color:var(--success)]/40 bg-[color:var(--success)]/10",
  Defaulted: "text-[color:var(--destructive)] border-[color:var(--destructive)]/40 bg-[color:var(--destructive)]/10",
};
const ZERO = "0x0000000000000000000000000000000000000000";

export default function Marketplace() {
  const [invoices, setInvoices] = useState<ChainInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRegisteredInvoices()
      .then(setInvoices)
      .catch(() => setInvoices([]))
      .finally(() => setLoading(false));
  }, []);

  const { data: usRisk } = useReadContract({
    address: CONTRACTS.jurisdictionOracle as `0x${string}`,
    abi: jurisdictionOracleAbi,
    functionName: "jurisdictionRiskBps",
    args: ["US"],
    query: { refetchInterval: 15000 },
  });

  // per-invoice: getInvoice (status/face) + gradeForInvoice (grade/discount)
  const reads = useMemo(
    () =>
      invoices.flatMap((inv) => [
        { address: CONTRACTS.registry as `0x${string}`, abi: registryAbi, functionName: "getInvoice", args: [inv.id] } as const,
        { address: CONTRACTS.attestation as `0x${string}`, abi: attestationAbi, functionName: "gradeForInvoice", args: [inv.id] } as const,
      ]),
    [invoices]
  );
  const { data: readsData } = useReadContracts({ contracts: reads, query: { enabled: reads.length > 0, refetchInterval: 12000 } });

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Invoice marketplace</h1>
          <p className="mt-1 text-muted-foreground">
            Live on-chain invoices from the registry. Each carries a TEE-signed grade; the buyer&apos;s financials stay private in the enclave.
          </p>
        </div>
        <Card className="px-4 py-3">
          <CardTitle>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Jurisdiction risk (US) · live via Web2Json
            </span>
          </CardTitle>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{usRisk !== undefined ? bpsToPct(usRisk) : "—"}</div>
        </Card>
      </div>

      {loading ? (
        <p className="mt-10 text-muted-foreground">Loading invoices from chain…</p>
      ) : invoices.length === 0 ? (
        <Card className="mt-8 text-center text-muted-foreground">No registered invoices found on-chain yet.</Card>
      ) : (
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {invoices.map((inv, i) => {
            const invData = readsData?.[2 * i]?.result as
              | { supplier: string; faceAmount: bigint; dueDate: bigint; status: number }
              | undefined;
            const grade = readsData?.[2 * i + 1]?.result as
              | { grade: string; discountRateBps: number; teeSigner: string }
              | undefined;
            const status = (invData ? REGISTRY_STATUS[Number(invData.status)] : "Registered") as Status;
            const attested = !!grade && grade.teeSigner !== ZERO;
            const gradeLetter = attested ? hexToString(grade!.grade as `0x${string}`, { size: 32 }).replace(/\0/g, "") : "?";
            const discountBps = attested ? grade!.discountRateBps : 0;

            return (
              <Card key={inv.id} className="flex flex-col gap-4 transition-colors hover:border-primary/40">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">Buyer (private)</div>
                    <div className="font-mono text-sm">{shortHex(inv.buyerCommitment, 5)}</div>
                  </div>
                  <RiskBadge grade={gradeLetter} />
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Field k="Face value" v={`${amount(inv.faceAmount, FXRP_DECIMALS)} FXRP`} />
                  <Field k="Discount" v={attested ? bpsToPct(discountBps) : "—"} />
                  <Field k="Due" v={new Date(inv.dueDate * 1000).toLocaleDateString()} />
                  <Field k="Supplier" v={shortHex(inv.supplier)} />
                </div>

                <div className="mt-auto flex items-center justify-between border-t border-border pt-4">
                  <Badge className={STATUS_STYLES[status]}>{status}</Badge>
                  <Link href={`/invoice/${inv.id}`}>
                    <Button size="sm" variant={status === "Registered" ? "primary" : "outline"}>
                      {status === "Registered" ? "Fund" : "View"}
                    </Button>
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Invoices are read live from the CifraInvoiceRegistry via the Coston2 explorer index; status and grade are read on-chain.
      </p>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{k}</div>
      <div className="font-medium tabular-nums">{v}</div>
    </div>
  );
}
