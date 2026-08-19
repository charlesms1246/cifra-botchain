"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useAccount, useChainId, useSwitchChain, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { hexToString } from "viem";
import {
  CONTRACTS,
  registryAbi,
  attestationAbi,
  controllerAbi,
  REGISTRY_STATUS,
} from "@/lib/contracts";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RiskBadge } from "@/components/risk-badge";
import { bpsToPct, shortHex } from "@/lib/format";
import { addrUrl, coston2 } from "@/lib/chain";
import { Check, Circle, ExternalLink, Lock, ArrowLeft } from "lucide-react";

const isBytes32 = (s: string) => /^0x[0-9a-fA-F]{64}$/.test(s);

export default function InvoiceDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const live = isBytes32(id);

  const { data } = useReadContracts({
    contracts: [
      { address: CONTRACTS.registry as `0x${string}`, abi: registryAbi, functionName: "exists", args: [id as `0x${string}`] },
      { address: CONTRACTS.registry as `0x${string}`, abi: registryAbi, functionName: "getInvoice", args: [id as `0x${string}`] },
      { address: CONTRACTS.attestation as `0x${string}`, abi: attestationAbi, functionName: "gradeForInvoice", args: [id as `0x${string}`] },
    ],
    query: { enabled: live, refetchInterval: 10000 },
  });

  const loading = live && data === undefined;
  const exists = (data?.[0]?.result as boolean | undefined) ?? false;
  const inv = data?.[1]?.result as { supplier: string; buyerCommitment: string; faceAmount: bigint; dueDate: bigint; status: number } | undefined;
  const grade = data?.[2]?.result as { grade: string; riskScoreBps: number; discountRateBps: number; teeSigner: string } | undefined;

  // Everything below is read live on-chain — no seed/fallback data.
  const status = exists && inv ? REGISTRY_STATUS[Number(inv.status)] : loading ? "…" : "—";
  const attested = !!grade && grade.teeSigner !== "0x0000000000000000000000000000000000000000";
  const gradeLetter = attested ? hexToString(grade!.grade as `0x${string}`, { size: 32 }).replace(/\0/g, "") : "?";
  const discountBps = attested ? grade!.discountRateBps : 0;
  const faceFxrp = inv ? Number(inv.faceAmount) / 1e6 : 0;
  const supplier = inv?.supplier ?? "—";

  const statusIdx = ["Registered", "Funded", "Settled"].indexOf(status === "Defaulted" ? "Settled" : status);
  const steps = [
    { key: "register", label: "Registered", done: statusIdx >= 0, sub: "XRPL-native supplier · Smart Accounts" },
    { key: "attest", label: "Scored & attested", done: attested || statusIdx >= 1, sub: attested ? `grade ${gradeLetter} · TEE ${shortHex(grade!.teeSigner)}` : "TEE-signed grade, bound to this invoice" },
    { key: "fund", label: "Funded", done: statusIdx >= 1, sub: `advance = face × (1 − ${bpsToPct(discountBps)})` },
    status === "Defaulted"
      ? { key: "default", label: "Defaulted", done: true, sub: "FDC ReferencedPaymentNonexistence" }
      : { key: "settle", label: "Settled", done: statusIdx >= 2, sub: "FDC Payment attestation · funders repaid" },
  ];

  // Honest not-found: a valid id that isn't registered on-chain shows nothing plausible.
  if (live && !loading && !exists) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-10">
        <Link href="/marketplace" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Marketplace
        </Link>
        <Card className="mt-4 text-center text-muted-foreground">
          <div className="font-mono text-xs">{shortHex(id, 8)}</div>
          <div className="mt-2">This invoice is not registered on-chain.</div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-5 py-10">
      <Link href="/marketplace" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Marketplace
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Invoice</h1>
            <RiskBadge grade={gradeLetter} />
          </div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">{shortHex(id, 8)}</div>
        </div>
        <Badge>{status}</Badge>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card><CardTitle>Face value</CardTitle><div className="mt-1 text-2xl font-semibold tabular-nums">{faceFxrp} FXRP</div></Card>
        <Card><CardTitle>Discount</CardTitle><div className="mt-1 text-2xl font-semibold tabular-nums">{bpsToPct(discountBps)}</div></Card>
        <Card>
          <CardTitle>Supplier</CardTitle>
          <a href={addrUrl(supplier)} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-lg font-medium hover:text-primary">
            {shortHex(supplier)} <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Card>
      </div>

      {/* Buyer privacy note */}
      <Card className="mt-4 flex items-center gap-3 border-primary/20 bg-primary/[0.04]">
        <Lock className="h-5 w-5 shrink-0 text-primary" />
        <p className="text-sm text-muted-foreground">
          The buyer's identity and financials are never on-chain — they're scored inside the TEE. Only the signed
          risk grade, bound to this invoice, reaches Flare.
        </p>
      </Card>

      {/* Lifecycle timeline */}
      <Card className="mt-4">
        <CardTitle>Lifecycle</CardTitle>
        <ol className="mt-4 space-y-5">
          {steps.map((s, i) => (
            <li key={s.key} className="flex gap-4">
              <div className="flex flex-col items-center">
                <span className={`grid h-7 w-7 place-items-center rounded-full border ${s.done ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}>
                  {s.done ? <Check className="h-4 w-4" /> : <Circle className="h-3 w-3" />}
                </span>
                {i < steps.length - 1 && <span className={`mt-1 h-8 w-px ${s.done ? "bg-primary/40" : "bg-border"}`} />}
              </div>
              <div className="pb-1">
                <div className="font-medium">{s.label}</div>
                <div className="text-sm text-muted-foreground">{s.sub}</div>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {status === "Registered" && <FundAction id={id} attested={attested} />}
    </div>
  );
}

function FundAction({ id, attested }: { id: string; attested: boolean }) {
  const { address, isConnected } = useAccount();
  const { data: operator } = useReadContract({
    address: CONTRACTS.controller as `0x${string}`,
    abi: controllerAbi,
    functionName: "operator",
  });
  const isOperator = isConnected && !!operator && address?.toLowerCase() === (operator as string).toLowerCase();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const wrongChain = isConnected && chainId !== coston2.id;
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: mining, isSuccess } = useWaitForTransactionReceipt({ hash });

  return (
    <Card className="mt-4">
      <CardTitle>Fund this invoice</CardTitle>
      <p className="mt-2 text-sm text-muted-foreground">
        Funding advances <code className="text-foreground">face × (1 − discount)</code> FXRP from the shared tranche
        pool to the supplier against the TEE grade. This is an operator-gated action (the vault keeper).
      </p>
      <Button
        className="mt-4"
        disabled={!isConnected || (!wrongChain && (!attested || !isOperator || isPending || mining || isSuccess))}
        onClick={() =>
          wrongChain
            ? switchChain({ chainId: coston2.id })
            : writeContract({ address: CONTRACTS.controller as `0x${string}`, abi: controllerAbi, functionName: "fundInvoice", args: [id as `0x${string}`], chainId: coston2.id })
        }
      >
        {!isConnected
          ? "Connect wallet"
          : wrongChain
          ? "Switch to Coston2"
          : !attested
          ? "Awaiting attestation"
          : !isOperator
          ? "Operator only"
          : isSuccess
          ? "Funded ✓"
          : isPending || mining
          ? "Confirming…"
          : "Fund invoice"}
      </Button>
      {isConnected && !isOperator && operator ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Connected wallet isn&apos;t the vault operator ({shortHex(operator as string)}).
        </p>
      ) : null}
      {error && <p className="mt-2 text-xs text-[color:var(--destructive)]">{(error as { shortMessage?: string }).shortMessage ?? "Transaction failed."}</p>}
    </Card>
  );
}
