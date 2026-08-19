import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ShinyText } from "@/components/shiny-text";
import { Badge } from "@/components/ui/badge";
import { PrivateScoringFlow } from "@/components/flow-diagrams";
import { LiveStats } from "@/components/live-stats";
import { txUrl, addrUrl } from "@/lib/chain";
import { Lock, Coins, ShieldCheck, ArrowRight, ExternalLink } from "lucide-react";

const STEPS = [
  { title: "Register", body: "An XRPL-native supplier registers an invoice with a single XRPL payment — no EVM wallet, via Flare Smart Accounts.", icon: Coins },
  { title: "Score privately", body: "The buyer's payment history is scored inside a TEE. Only a signed risk grade — bound to the invoice — ever reaches the chain.", icon: Lock },
  { title: "Fund & settle", body: "Funders advance FXRP against the grade; settlement and default are proven with FDC attestations.", icon: ShieldCheck },
];

// Real, verifiable Coston2 artifacts — links to the actual on-chain proof.
const PROOF = [
  { label: "Tranche settle — 50/50 split", href: txUrl("0xf1fea3ff0e3ec53c340d5e60e17b0a673522968b8ab35e6ca6f57491a3523610") },
  { label: "Default — junior first-loss", href: txUrl("0x2a8051f6eb5fb90838dcab34ce21935c05c42a2d840bb110b1d8fb6853a45c62") },
  { label: "Tranche controller — verified", href: addrUrl("0xC06e9546313c17dCf1a183789024159b4a7Dae18") },
  { label: "2-of-3 governance Safe", href: addrUrl("0x5D0549293b3B2C0434B7580414d5b8b7bFC83224") },
];

export default function Home() {
  return (
    <div>
      {/* Hero */}
      <section className="relative flex min-h-[calc(100vh-4rem)] flex-col justify-center overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-20 [background-image:radial-gradient(rgba(255,255,255,0.06)_1.2px,transparent_1.2px)] [background-size:20px_20px] [mask-image:linear-gradient(to_bottom,white,transparent)]" />
        <div className="relative z-10 mx-auto w-full max-w-7xl px-5 py-20">
          <Badge className="mb-6 text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Confidential Compute · Flare Coston2
          </Badge>
          <h1 className="mb-6 font-display text-6xl font-black leading-[0.85] tracking-tighter text-white sm:text-7xl lg:text-8xl">
            FACTOR INVOICES.
            <br />
            <ShinyText className="italic">KEEP CREDIT PRIVATE.</ShinyText>
          </h1>
          <p className="mb-10 max-w-xl text-left text-lg font-medium leading-relaxed text-white/60 sm:text-xl">
            Cifra prices real invoices for FXRP liquidity — the buyer&apos;s financials are scored inside a TEE and
            never touch the chain. Funders see only a <strong className="text-white">signed risk grade</strong>.
          </p>
          <div className="flex flex-col gap-4 sm:flex-row">
            <Link href="/dashboard">
              <Button size="lg" className="h-14 px-8 text-base font-bold">
                Provide liquidity <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/marketplace">
              <Button size="lg" variant="outline" className="h-14 px-8 text-base font-bold">
                Browse invoices
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* The mechanism — animated flow */}
      <section className="mx-auto max-w-6xl px-5 pb-8">
        <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          <span className="h-px w-6 bg-primary/50" /> The mechanism
        </div>
        <h2 className="mb-6 max-w-2xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          The data goes in. Only a signed grade comes out.
        </h2>
        <div className="overflow-x-auto rounded-2xl border border-border bg-card/40 p-4">
          <PrivateScoringFlow />
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-5 pb-8 pt-8">
        <div className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <Card key={s.title} className="cifra-float" style={{ animationDelay: `${i * 0.6}s` }}>
              <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-primary/12 text-primary">
                <s.icon className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Proven live on Coston2 */}
      <section className="mx-auto max-w-6xl px-5 pb-24 pt-8">
        <div className="rounded-3xl border border-border bg-gradient-to-b from-primary/[0.07] to-transparent p-8 sm:p-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="max-w-2xl font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              Not a mock. Every step is a real Coston2 transaction.
            </h2>
            <span className="text-xs font-semibold uppercase tracking-widest text-primary">Live on Coston2</span>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            A real TEE-signed grade, real FXRP, senior/junior tranches, FDC-proven settlement and default, FTSO-priced
            NAV — deployed, verified, and governed by a 2-of-3 multisig. These figures read live from chain:
          </p>

          <LiveStats />

          <div className="mt-6 flex flex-wrap gap-2">
            {PROOF.map((p) => (
              <a
                key={p.label}
                href={p.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-black/20 px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {p.label} <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
