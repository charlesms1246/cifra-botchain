"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { keccak256, parseUnits, stringToBytes, type Hex } from "viem";
import { registryAbi } from "@/lib/contracts";
import { SHARED } from "@/lib/books";
import { useBook } from "@/lib/use-book";
import { activeChain, txUrl } from "@/lib/chain";
import { BookSwitcher } from "@/components/book-switcher";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// ── Invoice document + commitment ────────────────────────────────────────────
// The full invoice — buyer, line items, terms — lives ONLY in this browser and, later, as
// private input to the scoring service. On-chain we store nothing but its keccak256: the
// `buyerCommitment`. That binds the exact invoice that was factored (you cannot swap what was
// financed) while revealing nothing. Face value is derived from the line items, so the on-chain
// amount is provably the sum of what was committed.

type LineItem = { description: string; quantity: number; unitPrice: string };

type InvoiceDoc = {
  buyer: string;
  buyerCountry: string;
  lineItems: LineItem[];
  terms: string;
  issueDate: string;
  dueDate: number;
  currency: string;
};

function faceUnits(items: LineItem[], decimals: number): bigint {
  return items.reduce((sum, it) => {
    const price = it.unitPrice.trim() === "" ? 0n : safeParse(it.unitPrice.trim(), decimals);
    const qty = BigInt(Math.max(0, Math.floor(Number(it.quantity) || 0)));
    return sum + price * qty;
  }, 0n);
}

/** Deterministic serialization of the committed fields — fixed key order, trimmed. Versioned so
 *  the scheme can evolve without ambiguity. Never sent on-chain; only its hash is. */
function canonical(doc: InvoiceDoc): string {
  return JSON.stringify({
    v: 2,
    buyer: doc.buyer.trim(),
    buyerCountry: doc.buyerCountry.trim().toUpperCase(),
    lineItems: doc.lineItems.map((li) => ({
      description: li.description.trim(),
      quantity: Math.floor(Number(li.quantity) || 0),
      unitPrice: li.unitPrice.trim(),
    })),
    terms: doc.terms.trim(),
    issueDate: doc.issueDate,
    dueDate: doc.dueDate,
    currency: doc.currency,
  });
}

const commitmentOf = (doc: InvoiceDoc): Hex => keccak256(stringToBytes(canonical(doc)));

export default function OnboardPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-3xl px-4 py-10 sm:px-5">Loading…</div>}>
      <Onboard />
    </Suspense>
  );
}

function Onboard() {
  const [book, setBook] = useBook();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient();
  const wrongChain = isConnected && chainId !== activeChain.id;

  const [buyer, setBuyer] = useState("");
  const [buyerCountry, setBuyerCountry] = useState("DE");
  const [terms, setTerms] = useState("Net 30");
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [items, setItems] = useState<LineItem[]>([{ description: "", quantity: 1, unitPrice: "" }]);
  // Captured once at mount. Reading the clock during render is impure and makes the component
  // re-render to a different answer for the same props.
  const [todayIso] = useState(() => new Date().toISOString().slice(0, 10));
  const [invoiceId, setInvoiceId] = useState<Hex | null>(null);

  const { writeContractAsync, isPending, error, reset } = useWriteContract();
  const [hash, setHash] = useState<Hex | undefined>();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const doc: InvoiceDoc = useMemo(
    () => ({
      buyer,
      buyerCountry,
      lineItems: items,
      terms,
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: Math.floor(new Date(dueDate + "T00:00:00Z").getTime() / 1000),
      currency: book.symbol,
    }),
    [buyer, buyerCountry, items, terms, dueDate, book.symbol]
  );

  const face = faceUnits(items, book.decimals);
  const commitment = commitmentOf(doc);
  // ISO dates compare correctly as strings, so this needs no clock read.
  const valid = buyer.trim() !== "" && face > 0n && dueDate > todayIso;

  const submit = async () => {
    reset();
    if (!valid || !address || !publicClient) return;
    // A supplier-chosen salt so two otherwise-identical invoices get distinct ids. Generated
    // here, in the event handler — deriving it during render would change the committed
    // invoice id on every keystroke.
    const ref = keccak256(stringToBytes(`${address}:${crypto.randomUUID()}`));
    const predicted = (await publicClient.readContract({
      address: SHARED.registry,
      abi: registryAbi,
      functionName: "computeInvoiceId",
      args: [address, commitment, face, BigInt(doc.dueDate), ref],
    })) as Hex;

    const tx = await writeContractAsync({
      address: SHARED.registry,
      abi: registryAbi,
      functionName: "registerInvoice",
      args: [commitment, face, BigInt(doc.dueDate), ref],
    });
    setHash(tx);
    setInvoiceId(predicted);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Factor an invoice</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Register a receivable for funding. Everything you type stays in this browser — only a
            hash of it reaches the chain.
          </p>
        </div>
        <BookSwitcher value={book} onChange={setBook} />
      </div>

      <Card className="mt-6">
        <CardTitle>Buyer</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Never published. It is hashed into the commitment below, and passed privately to the
          scoring service when the invoice is graded.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_8rem]">
          <Field label="Buyer name" value={buyer} onChange={setBuyer} placeholder="Acme GmbH" />
          <Field label="Country" value={buyerCountry} onChange={(v) => setBuyerCountry(v.toUpperCase().slice(0, 2))} placeholder="DE" />
        </div>
      </Card>

      <Card className="mt-4">
        <CardTitle>Line items</CardTitle>
        <div className="mt-4 space-y-3">
          {items.map((it, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_5rem_8rem_2rem]">
              <Field
                label={i === 0 ? "Description" : undefined}
                value={it.description}
                onChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, description: v } : x)))}
                placeholder="Consulting, March"
              />
              <Field
                label={i === 0 ? "Qty" : undefined}
                value={String(it.quantity)}
                onChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: Number(v.replace(/\D/g, "")) || 0 } : x)))}
              />
              <Field
                label={i === 0 ? `Unit (${book.symbol})` : undefined}
                value={it.unitPrice}
                onChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, unitPrice: v.replace(/[^0-9.]/g, "") } : x)))}
                placeholder="0.00"
              />
              <button
                onClick={() => setItems(items.length > 1 ? items.filter((_, j) => j !== i) : items)}
                className={`h-11 rounded-lg border border-border text-muted-foreground hover:text-foreground ${i === 0 ? "sm:mt-6" : ""}`}
                aria-label="Remove line"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => setItems([...items, { description: "", quantity: 1, unitPrice: "" }])}
          className="mt-3 text-xs font-semibold text-primary hover:underline"
        >
          + Add line
        </button>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Field label="Payment terms" value={terms} onChange={setTerms} placeholder="Net 30" />
          <Field label="Due date" type="date" value={dueDate} onChange={setDueDate} />
        </div>
      </Card>

      <Card className="mt-4">
        <CardTitle>What goes on-chain</CardTitle>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex items-start justify-between gap-4">
            <dt className="text-muted-foreground">Face value</dt>
            <dd className="font-semibold tabular-nums">
              {(Number(face) / 10 ** book.decimals).toLocaleString(undefined, { maximumFractionDigits: 6 })} {book.symbol}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="shrink-0 text-muted-foreground">Buyer commitment</dt>
            <dd className="break-all text-right font-mono text-xs">{commitment}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          That hash, the face value and the due date are all that is published. The buyer&apos;s
          name, country and your line items are not — but the hash binds them, so the invoice
          that was financed cannot be swapped for a different one afterwards.
        </p>
      </Card>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        {wrongChain ? (
          <Button className="h-11" onClick={() => switchChain({ chainId: activeChain.id })}>
            Switch to {activeChain.name}
          </Button>
        ) : (
          <Button className="h-11" onClick={submit} disabled={!isConnected || !valid || isPending || confirming}>
            {isPending || confirming ? "Confirming…" : "Register invoice"}
          </Button>
        )}
        {!isConnected && <p className="text-xs text-muted-foreground">Connect a wallet to register.</p>}
        {isConnected && !valid && (
          <p className="text-xs text-muted-foreground">Add a buyer, at least one priced line, and a future due date.</p>
        )}
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-[color:var(--destructive)]/40 bg-[color:var(--destructive)]/10 p-3 text-xs text-[color:var(--destructive)]">
          {(error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 200)}
        </p>
      )}

      {isSuccess && invoiceId && (
        <Card className="mt-4 border-[color:var(--success)]/40">
          <CardTitle>Registered</CardTitle>
          <p className="mt-2 break-all font-mono text-xs">{invoiceId}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href={`/invoice/${invoiceId}?book=${book.key}`}>
              <Button size="sm">View invoice</Button>
            </Link>
            {hash && (
              <a href={txUrl(hash)} target="_blank" rel="noreferrer">
                <Button size="sm" variant="outline">
                  View transaction
                </Button>
              </a>
            )}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Next: the scoring service grades the buyer and signs the result, then the operator
            funds the invoice from the {book.label} pool.
          </p>
        </Card>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-border bg-black/20 px-3 text-sm outline-none focus:border-primary/60"
      />
    </label>
  );
}

function safeParse(v: string, decimals: number): bigint {
  try {
    return parseUnits(v, decimals);
  } catch {
    return 0n;
  }
}
