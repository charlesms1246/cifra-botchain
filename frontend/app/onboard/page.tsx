"use client";

import { useEffect, useMemo, useState } from "react";
import { useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { CONTRACTS, macAbi, assetManagerAbi, registryAbi, REGISTRY_STATUS, FXRP_DECIMALS } from "@/lib/contracts";
import { buildOnboardInstruction, invoiceCommitment, invoiceFaceUnits, refOf, type OnboardInstruction, type InvoiceDoc, type LineItem } from "@/lib/onboard";
import { coston2, addrUrl } from "@/lib/chain";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { shortHex } from "@/lib/format";
import { Wallet, FileText, Send, CheckCircle2, ExternalLink, Copy, Plus, Trash2, Lock } from "lucide-react";

const blankItem = (): LineItem => ({ description: "", quantity: 1, unitPrice: "" });

type XrplWallet = { address: string; seed: string };

export default function Onboard() {
  const [wallet, setWallet] = useState<XrplWallet | null>(null);
  const [generating, setGenerating] = useState(false);
  const [buyer, setBuyer] = useState("ACME Corp");
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: "Consulting — March", quantity: 1, unitPrice: "5" }]);
  const [tenor, setTenor] = useState("30");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(OnboardInstruction & { xrplHash: string }) | null>(null);

  const addItem = () => setLineItems((p) => [...p, blankItem()]);
  const removeItem = (i: number) => setLineItems((p) => (p.length <= 1 ? p : p.filter((_, j) => j !== i)));
  const updateItem = (i: number, patch: Partial<LineItem>) => setLineItems((p) => p.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  // The invoice document lives only in the browser; only its keccak256 (buyerCommitment) + the
  // derived face value go on-chain. Recomputed live so the supplier sees the binding hash.
  const faceUnits = useMemo(() => invoiceFaceUnits(lineItems), [lineItems]);
  const invoiceDoc = useMemo<InvoiceDoc>(() => ({
    buyer: buyer.trim() || "buyer",
    lineItems,
    terms: `Net ${tenor || "30"}`,
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: Math.floor(Date.now() / 1000) + Number(tenor || "30") * 86400,
    currency: "FXRP",
  }), [buyer, lineItems, tenor]);
  const commitment = useMemo(() => invoiceCommitment(invoiceDoc), [invoiceDoc]);

  // Live reads: supplier's deterministic PersonalAccount + its nonce, and the Core Vault address.
  const zero = "0x0000000000000000000000000000000000000000" as const;
  const { data: personalAccount } = useReadContract({
    address: CONTRACTS.masterAccountController as `0x${string}`, abi: macAbi, functionName: "getPersonalAccount",
    args: [wallet?.address ?? ""], query: { enabled: !!wallet }, chainId: coston2.id,
  });
  const { data: nonce } = useReadContract({
    address: CONTRACTS.masterAccountController as `0x${string}`, abi: macAbi, functionName: "getNonce",
    args: [(personalAccount as `0x${string}`) ?? zero], query: { enabled: !!personalAccount }, chainId: coston2.id,
  });
  const { data: coreVault } = useReadContract({
    address: CONTRACTS.assetManagerFXRP as `0x${string}`, abi: assetManagerAbi, functionName: "directMintingPaymentAddress",
    chainId: coston2.id,
  });

  async function generateWallet() {
    setError(null); setGenerating(true);
    try {
      const { fundTestnetWallet } = await import("@/lib/xrpl-submit");
      setWallet(await fundTestnetWallet());
    } catch (e: unknown) {
      setError(`Couldn't fund a testnet wallet: ${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
  }

  async function submit() {
    if (!wallet || !personalAccount || nonce === undefined || !coreVault) return;
    setError(null); setSubmitting(true);
    try {
      const instruction = buildOnboardInstruction({
        personalAccount: personalAccount as `0x${string}`,
        nonce: nonce as bigint,
        registry: CONTRACTS.registry as `0x${string}`,
        buyerCommitment: commitment, // keccak256 of the full invoice document
        faceAmount: faceUnits, // Σ qty × unitPrice
        dueDate: BigInt(invoiceDoc.dueDate),
        ref: refOf("INV-" + Date.now()),
      });
      const { submitOnboardPayment } = await import("@/lib/xrpl-submit");
      const { hash, result: txResult } = await submitOnboardPayment({
        seed: wallet.seed, coreVault: coreVault as string, amountXrp: "5", memoHex: instruction.memoHex,
      });
      if (txResult !== "tesSUCCESS") throw new Error(`XRPL payment returned ${txResult}`);
      setResult({ ...instruction, xrplHash: hash });
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const faceValid = faceUnits > 0n;
  const canSubmit = !!wallet && !!personalAccount && nonce !== undefined && !!coreVault && faceValid && !submitting && !result;

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <Badge className="mb-4 text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" /> XRPL-native · no EVM wallet
      </Badge>
      <h1 className="font-display text-3xl font-semibold tracking-tight">Onboard as a supplier</h1>
      <p className="mt-2 max-w-xl text-muted-foreground">
        Register an invoice from a single XRPL payment. No FLR, no MetaMask — your XRPL wallet controls a
        deterministic smart account on Flare via Smart Accounts.
      </p>

      {/* Step 1 — XRPL wallet + PersonalAccount (LIVE) */}
      <Card className="mt-8">
        <div className="flex items-center gap-3">
          <StepDot n={1} icon={Wallet} />
          <CardTitle>Your XRPL wallet & Flare smart account</CardTitle>
        </div>
        {!wallet ? (
          <>
            <p className="mt-3 text-sm text-muted-foreground">
              Get a fresh XRPL testnet wallet — a supplier with zero prior state and no EVM key. Cifra derives your
              deterministic <span className="text-foreground">PersonalAccount</span> on Flare from it.
            </p>
            <Button className="mt-4" onClick={generateWallet} disabled={generating}>
              {generating ? "Funding on XRPL testnet…" : "Generate XRPL testnet wallet"}
            </Button>
          </>
        ) : (
          <div className="mt-3 space-y-3">
            <KV label="XRPL address" value={wallet.address} mono />
            {personalAccount ? (
              <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/[0.04] px-4 py-3">
                <div>
                  <div className="text-xs text-muted-foreground">PersonalAccount (Flare) · nonce {nonce?.toString() ?? "…"}</div>
                  <div className="font-mono">{shortHex(personalAccount as string, 6)}</div>
                </div>
                <a href={addrUrl(personalAccount as string)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  explorer <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Deriving PersonalAccount…</p>
            )}
          </div>
        )}
      </Card>

      {/* Step 2 — invoice (rich; committed but private) */}
      <Card className="mt-4">
        <div className="flex items-center gap-3">
          <StepDot n={2} icon={FileText} />
          <CardTitle>Describe the invoice</CardTitle>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Buyer (kept private)" value={buyer} onChange={setBuyer} placeholder="ACME Corp" />
          <Field label="Tenor (days)" value={tenor} onChange={(v) => setTenor(v.replace(/[^0-9]/g, ""))} placeholder="30" />
        </div>

        {/* Line items */}
        <div className="mt-4">
          <div className="mb-1.5 grid grid-cols-[1fr_4rem_6rem_1.5rem] gap-2 px-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            <span>Description</span><span className="text-right">Qty</span><span className="text-right">Unit (FXRP)</span><span />
          </div>
          <div className="space-y-2">
            {lineItems.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_4rem_6rem_1.5rem] items-center gap-2">
                <input value={it.description} onChange={(e) => updateItem(i, { description: e.target.value })} placeholder="Consulting — March"
                  className="rounded-lg border border-input bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50" />
                <input value={it.quantity} inputMode="numeric" onChange={(e) => updateItem(i, { quantity: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })}
                  className="rounded-lg border border-input bg-black/20 px-2 py-2 text-right text-sm tabular-nums outline-none focus:border-primary/50" />
                <input value={it.unitPrice} inputMode="decimal" onChange={(e) => updateItem(i, { unitPrice: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="0.0"
                  className="rounded-lg border border-input bg-black/20 px-2 py-2 text-right text-sm tabular-nums outline-none focus:border-primary/50" />
                <button onClick={() => removeItem(i)} disabled={lineItems.length <= 1}
                  className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:text-foreground disabled:opacity-30"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
          <button onClick={addItem} className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"><Plus className="h-3 w-3" /> add line item</button>
        </div>

        {/* Live invoice preview — exactly what gets committed (client-side only; never stored/sent) */}
        <InvoicePreview doc={invoiceDoc} faceUnits={faceUnits} commitment={commitment} supplierPA={personalAccount as string | undefined} supplierXrpl={wallet?.address} />
      </Card>

      {/* Step 3 — the payment (LIVE) */}
      <Card className="mt-4">
        <div className="flex items-center gap-3">
          <StepDot n={3} icon={Send} />
          <CardTitle>Send one XRPL payment</CardTitle>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Your invoice is packed into a Smart Accounts custom instruction (memo opcode <code className="text-foreground">0xFE</code>) and sent
          in a single XRPL payment to the FAssets Core Vault{coreVault ? <> (<span className="font-mono text-xs">{shortHex(coreVault as string, 4)}</span>)</> : ""}.
          An operator executor relays it to Flare — your PersonalAccount registers the invoice. You pay zero gas.
        </p>
        <Button className="mt-4" onClick={submit} disabled={!canSubmit}>
          {submitting ? "Submitting XRPL payment…" : result ? "Payment sent ✓" : "Register via one XRPL payment"}
        </Button>
        {error && <p className="mt-3 text-xs text-[color:var(--destructive)]">{error}</p>}
        {result && (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <KV label="XRPL payment" value={result.xrplHash} mono href={`https://testnet.xrpl.org/transactions/${result.xrplHash}`} />
            <KV label="Predicted invoiceId" value={result.invoiceId} mono />
            <details className="rounded-xl border border-border bg-black/20 p-3">
              <summary className="cursor-pointer text-xs text-muted-foreground">userOp bytes (for the operator executor)</summary>
              <div className="mt-2 flex items-start gap-2">
                <code className="block max-h-24 overflow-auto break-all font-mono text-[10px] text-muted-foreground">{result.userOpData}</code>
                <button onClick={() => navigator.clipboard.writeText(result.userOpData)} className="shrink-0 rounded-md border border-border p-1 text-muted-foreground hover:text-foreground"><Copy className="h-3 w-3" /></button>
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">
                Operator: <code>XRPL_HASH={result.xrplHash.slice(0, 10)}… USER_OP_DATA=… npx hardhat run scripts/executeOnboard.ts --network coston2</code>
              </p>
            </details>
          </div>
        )}
      </Card>

      {/* Step 4 — executor + confirmation (LIVE poll) */}
      {result && <Confirmation invoiceId={result.invoiceId} personalAccount={personalAccount as string} />}
    </div>
  );
}

function Confirmation({ invoiceId, personalAccount }: { invoiceId: string; personalAccount?: string }) {
  const { data: exists } = useReadContract({
    address: CONTRACTS.registry as `0x${string}`, abi: registryAbi, functionName: "exists",
    args: [invoiceId as `0x${string}`], chainId: coston2.id, query: { refetchInterval: 5000 },
  });
  const { data: invoice } = useReadContract({
    address: CONTRACTS.registry as `0x${string}`, abi: registryAbi, functionName: "getInvoice",
    args: [invoiceId as `0x${string}`], chainId: coston2.id, query: { enabled: !!exists, refetchInterval: 5000 },
  });
  const inv = invoice as { supplier: string; faceAmount: bigint; status: number } | undefined;
  const ownedByPA = inv && personalAccount && inv.supplier.toLowerCase() === personalAccount.toLowerCase();

  return (
    <Card className="mt-4">
      <div className="flex items-center gap-3">
        <StepDot n={4} icon={CheckCircle2} />
        <CardTitle>Registered on Flare</CardTitle>
      </div>
      {!exists ? (
        <p className="mt-3 text-sm text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> Awaiting the operator executor — it proves your XRPL
          payment via FDC and runs the instruction on your PersonalAccount. This page polls the registry live.
        </p>
      ) : (
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-center gap-2 text-[color:var(--success,#3fb950)]">
            <CheckCircle2 className="h-4 w-4" /> Invoice registered — owned by your PersonalAccount {ownedByPA ? "✓" : ""}
          </div>
          {inv && (
            <div className="mt-2 space-y-1 text-muted-foreground">
              <Row k="Face" v={`${Number(inv.faceAmount) / 10 ** FXRP_DECIMALS} FXRP`} />
              <Row k="Status" v={REGISTRY_STATUS[inv.status] ?? String(inv.status)} />
              <Row k="Supplier" v={shortHex(inv.supplier, 6)} />
            </div>
          )}
          <a href={addrUrl(personalAccount ?? "")} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
            PersonalAccount on explorer <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
    </Card>
  );
}

// A live, styled render of the exact invoice being committed. Purely client-side — it is never
// stored or transmitted; only its keccak256 (shown in the footer) reaches the chain.
function InvoicePreview({ doc, faceUnits, commitment, supplierPA, supplierXrpl }: {
  doc: InvoiceDoc; faceUnits: bigint; commitment: string; supplierPA?: string; supplierXrpl?: string;
}) {
  const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const dueDateStr = new Date(doc.dueDate * 1000).toISOString().slice(0, 10);
  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-white/[0.035] to-transparent">
      <div className="flex items-start justify-between border-b border-border px-6 py-5">
        <div>
          <div className="font-display text-2xl font-bold tracking-tight text-white">INVOICE</div>
          <div className="mt-0.5 text-xs text-muted-foreground">Cifra · factored on Flare</div>
        </div>
        <span className="rounded-full border border-primary/30 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">Draft · preview</span>
      </div>

      <div className="grid gap-4 px-6 py-5 sm:grid-cols-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">From</div>
          <div className="mt-1 font-mono text-sm text-foreground">{supplierXrpl ? shortHex(supplierXrpl, 6) : "your XRPL wallet"}</div>
          <div className="text-[11px] text-muted-foreground">{supplierPA ? <>PA {shortHex(supplierPA, 4)}</> : "PersonalAccount (Flare)"}</div>
        </div>
        <div className="sm:text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Bill to</div>
          <div className="mt-1 text-sm text-foreground">{doc.buyer}</div>
          <div className="text-[11px] text-muted-foreground">identity kept private · committed as a hash</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 border-t border-border px-6 py-3 text-xs">
        <div><div className="text-muted-foreground">Issued</div><div className="tabular-nums">{doc.issueDate}</div></div>
        <div><div className="text-muted-foreground">Due</div><div className="tabular-nums">{dueDateStr}</div></div>
        <div><div className="text-muted-foreground">Terms</div><div>{doc.terms}</div></div>
      </div>

      <div className="px-6 py-4">
        <div className="grid grid-cols-[1fr_2.5rem_5rem_5rem] gap-2 border-b border-border pb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>Description</span><span className="text-right">Qty</span><span className="text-right">Unit</span><span className="text-right">Amount</span>
        </div>
        {doc.lineItems.map((li, i) => (
          <div key={i} className="grid grid-cols-[1fr_2.5rem_5rem_5rem] gap-2 border-b border-border/40 py-2 text-sm">
            <span className="truncate text-foreground">{li.description || <span className="text-muted-foreground">—</span>}</span>
            <span className="text-right tabular-nums">{li.quantity}</span>
            <span className="text-right tabular-nums">{li.unitPrice || "0"}</span>
            <span className="text-right tabular-nums">{money((Number(li.unitPrice) || 0) * (li.quantity || 0))}</span>
          </div>
        ))}
        <div className="mt-3 flex items-center justify-end gap-6">
          <span className="text-sm text-muted-foreground">Total due</span>
          <span className="font-display text-xl font-bold tabular-nums text-primary">{formatUnits(faceUnits, FXRP_DECIMALS)} FXRP</span>
        </div>
      </div>

      <div className="border-t border-border bg-primary/[0.04] px-6 py-4">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary"><Lock className="h-3 w-3" /> committed on-chain</div>
        <code className="mt-1 block break-all font-mono text-[11px] text-foreground">{commitment}</code>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          keccak256 of this exact invoice — buyer, line items, terms. Only the hash reaches Flare; the document itself never leaves your
          browser (and, when scored, the TEE). Change any line and the hash changes.
        </p>
      </div>
    </div>
  );
}

function StepDot({ n, icon: Icon }: { n: number; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-primary/12 text-primary">
      <Icon className="h-4 w-4" />
      <span className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">{n}</span>
    </span>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="mt-1 w-full rounded-xl border border-input bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50" />
    </label>
  );
}

function KV({ label, value, mono, href }: { label: string; value: string; mono?: boolean; href?: string }) {
  return (
    <div className="rounded-xl border border-border bg-black/20 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 text-primary hover:underline ${mono ? "font-mono text-xs" : ""}`}>
          {shortHex(value, 8)} <ExternalLink className="h-3 w-3" />
        </a>
      ) : (
        <div className={mono ? "break-all font-mono text-xs" : ""}>{value}</div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span>{k}</span><span className="tabular-nums text-foreground">{v}</span>
    </div>
  );
}
