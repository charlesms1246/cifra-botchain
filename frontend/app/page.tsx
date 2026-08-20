import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ShinyText } from "@/components/shiny-text";
import { Badge } from "@/components/ui/badge";
import { PrivateScoringFlow } from "@/components/flow-diagrams";
import { LiveStats } from "@/components/live-stats";
import { addrUrl } from "@/lib/chain";
import { BOOKS, SHARED } from "@/lib/books";
import { Lock, Coins, ShieldCheck, ArrowRight, ExternalLink } from "lucide-react";

const STEPS = [
  {
    title: "Register",
    body: "A supplier registers a receivable. The buyer is stored as a commitment hash — their name and financials are never published.",
    icon: Coins,
  },
  {
    title: "Score privately",
    body: "The buyer's payment history goes to the scoring service and nowhere else. Only a signed grade — bound to that one invoice — reaches the chain.",
    icon: Lock,
  },
  {
    title: "Fund & settle",
    body: "Funders advance BOT or USDT against the grade. The buyer repays on-chain and the contract observes the payment itself — no oracle.",
    icon: ShieldCheck,
  },
];

const PROOF = [
  { label: "Invoice registry", href: addrUrl(SHARED.registry) },
  { label: "Attestation NFT", href: addrUrl(SHARED.attestation) },
  ...BOOKS.map((b) => ({ label: `${b.label} tranche controller`, href: addrUrl(b.controller) })),
];

export default function Home() {
  return (
    <div>
      {/* Hero */}
      <section className="relative flex min-h-[calc(100vh-4rem)] flex-col justify-center overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-20 [background-image:radial-gradient(rgba(255,255,255,0.06)_1.2px,transparent_1.2px)] [background-size:20px_20px] [mask-image:linear-gradient(to_bottom,white,transparent)]" />
        <div className="relative z-10 mx-auto w-full max-w-7xl px-4 py-20 sm:px-5">
          <Badge className="mb-6 text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Real-world assets · BOT Chain
          </Badge>
          <h1 className="mb-6 font-display text-5xl font-black leading-[0.9] tracking-tighter text-white sm:text-7xl lg:text-8xl">
            FACTOR INVOICES.
            <br />
            <ShinyText className="italic">KEEP CREDIT PRIVATE.</ShinyText>
          </h1>
          <p className="mb-8 max-w-2xl text-base text-muted-foreground sm:text-lg">
            $2.5 trillion of unmet trade finance, and the blocker isn&apos;t capital — it&apos;s
            that getting scored means handing over your customer list. Cifra makes the credit
            decision without the data ever becoming public, and settles the whole loop on-chain.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/dashboard">
              <Button className="h-12 w-full px-6 sm:w-auto">
                Fund a vault <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/onboard">
              <Button variant="outline" className="h-12 w-full px-6 sm:w-auto">
                Factor an invoice
              </Button>
            </Link>
          </div>
          <LiveStats />
        </div>
      </section>

      {/* How */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-5">
        <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">How it works</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <Card key={s.title}>
              <s.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-4 font-display text-xl font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
            </Card>
          ))}
        </div>

        <div className="mt-10 overflow-x-auto rounded-2xl border border-border bg-black/20 p-4 sm:p-6">
          <PrivateScoringFlow />
        </div>
      </section>

      {/* Trust */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-5">
        <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          What we guarantee, and what we don&apos;t
        </h2>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
          Cifra used to run its scoring inside a hardware-attested enclave. On BOT Chain it does
          not, and the honest version of the claim is narrower. Here is the whole of it.
        </p>

        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <tbody>
              {[
                ["The grade came from the key registered on-chain", "yes", "verified by ecrecover in the attestation contract"],
                ["The grade is bound to exactly one invoice", "yes", "the invoice id is inside the signed payload"],
                ["Raw buyer data never reaches the chain", "yes", "only the grade is submitted"],
                ["Settlement and default are honest", "yes", "directly observable on-chain — no oracle"],
                ["The published model produced the grade", "check", "the model version and container digest are signed and recorded — pull the image and recompute"],
                ["The operator cannot read buyer data", "no", "the service receives it over TLS. Encryption keeps it out of logs, not away from us."],
              ].map(([claim, verdict, detail]) => (
                <tr key={claim} className="border-b border-border align-top">
                  <td className="py-3 pr-4 font-medium">{claim}</td>
                  <td className="w-24 py-3 pr-4">
                    <span
                      className={
                        verdict === "yes"
                          ? "text-[color:var(--success)]"
                          : verdict === "no"
                            ? "text-[color:var(--destructive)]"
                            : "text-[color:var(--warning)]"
                      }
                    >
                      {verdict === "yes" ? "Guaranteed" : verdict === "no" ? "No" : "Checkable"}
                    </span>
                  </td>
                  <td className="py-3 text-muted-foreground">{detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Proof */}
      <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-5">
        <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Verify it yourself</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Every contract below is deployed and source-verified. Nothing on this page is a mockup.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {PROOF.map((p) => (
            <a
              key={p.label}
              href={p.href}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded-xl border border-border bg-black/20 p-4 text-sm transition-colors hover:border-primary/40"
            >
              {p.label}
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
