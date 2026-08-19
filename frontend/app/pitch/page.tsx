"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Lock, ShieldCheck, Coins, FileSignature, Banknote, Scale, ArrowRight, ChevronLeft, ChevronRight, Check } from "lucide-react";
import { PrivateScoringFlow, CapitalCycleFlow, FullLoopFlow } from "@/components/flow-diagrams";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
      <span className="h-px w-6 bg-primary/50" /> {children}
    </div>
  );
}

export default function Pitch() {
  const slides = buildSlides();
  const total = slides.length;
  const [i, setI] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) { e.preventDefault(); setI((c) => Math.min(total - 1, c + 1)); }
      else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) { e.preventDefault(); setI((c) => Math.max(0, c - 1)); }
      else if (e.key === "Home") setI(0);
      else if (e.key === "End") setI(total - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total]);

  return (
    <div className="relative h-[calc(100vh-4rem)] w-full overflow-hidden">
      {/* progress bar */}
      <div className="absolute inset-x-0 top-0 z-20 h-0.5 bg-white/[0.06]">
        <div className="h-full bg-primary transition-all duration-500" style={{ width: `${((i + 1) / total) * 100}%` }} />
      </div>

      {/* slide track */}
      <div
        className="flex h-full transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{ transform: `translateX(-${i * 100}%)` }}
      >
        {slides.map((node, idx) => (
          <section key={idx} className="h-full w-full shrink-0 overflow-y-auto">
            <div className="mx-auto flex min-h-full max-w-5xl flex-col justify-center px-6 py-16 sm:px-10">
              <motion.div
                animate={{ opacity: idx === i ? 1 : 0, y: idx === i ? 0 : 18 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              >
                {node}
              </motion.div>
            </div>
          </section>
        ))}
      </div>

      {/* prev / next */}
      <button
        onClick={() => setI((c) => Math.max(0, c - 1))}
        disabled={i === 0}
        aria-label="Previous slide"
        className="absolute left-2 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-border bg-card/60 text-muted-foreground backdrop-blur transition hover:text-foreground disabled:pointer-events-none disabled:opacity-0 sm:left-5"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        onClick={() => setI((c) => Math.min(total - 1, c + 1))}
        disabled={i === total - 1}
        aria-label="Next slide"
        className="absolute right-2 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-border bg-card/60 text-muted-foreground backdrop-blur transition hover:text-foreground disabled:pointer-events-none disabled:opacity-0 sm:right-5"
      >
        <ChevronRight className="h-5 w-5" />
      </button>

      {/* bottom chrome: hint · dots · counter */}
      <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex items-center justify-between px-6 sm:px-10">
        <span className="hidden text-xs text-muted-foreground sm:block">← → to navigate</span>
        <div className="pointer-events-auto mx-auto flex items-center gap-2">
          {slides.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setI(idx)}
              aria-label={`Go to slide ${idx + 1}`}
              className={`h-1.5 rounded-full transition-all ${idx === i ? "w-6 bg-primary" : "w-1.5 bg-white/25 hover:bg-white/45"}`}
            />
          ))}
        </div>
        <span className="hidden text-xs tabular-nums text-muted-foreground sm:block">
          {String(i + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}

/* ────────────────────────── Slides ────────────────────────── */

function buildSlides(): React.ReactNode[] {
  return [
    // 0 — Hero
    <div key="hero" className="text-center">
      <Badge className="mx-auto mb-6 text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Bounty 2 · Confidential Compute Apps
      </Badge>
      <h1 className="font-display text-5xl font-black leading-[0.9] tracking-tight text-white sm:text-7xl">
        PRIVATE INVOICE FACTORING,<br />
        <span className="text-primary">SETTLED ON FLARE.</span>
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/60">
        Suppliers turn unpaid invoices into FXRP. The buyer&apos;s credit is scored <em className="text-white/90">privately inside a
        Flare TEE</em> — their identity and financials never leave the enclave. Funders see only a signed risk grade.
      </p>
      <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
        <Link href="/onboard"><Button size="lg" className="h-13 px-7 font-bold">Onboard an invoice <ArrowRight className="h-4 w-4" /></Button></Link>
        <Link href="/dashboard"><Button size="lg" variant="outline" className="h-13 px-7 font-bold">Provide liquidity</Button></Link>
      </div>
    </div>,

    // 1 — Problem
    <div key="problem">
      <SectionLabel>The problem</SectionLabel>
      <h2 className="max-w-3xl font-display text-3xl font-bold tracking-tight sm:text-5xl">
        Factoring forces suppliers to expose their customers.
      </h2>
      <p className="mt-5 max-w-2xl leading-relaxed text-muted-foreground">
        The world&apos;s unmet demand for trade finance is <strong className="text-foreground">$2.5&nbsp;trillion</strong>, and SMEs are
        rejected at a <strong className="text-foreground">41%</strong> rate. The deeper blocker isn&apos;t capital — to get scored, a supplier
        must hand a middleman their debtor names, payment histories, and financials. For most SMBs that&apos;s a dealbreaker on its own.
        A TEE removes the tradeoff: a credit decision on real data, without that data ever becoming visible to the operator.
      </p>
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["$2.5T", "unmet demand"], ["41%", "SME rejection"], ["0", "debtor records held"], ["1", "grade funders see"]].map(([v, l]) => (
          <div key={l} className="rounded-2xl border border-border bg-card/60 p-5">
            <div className="font-display text-3xl font-bold text-primary">{v}</div>
            <div className="mt-1 text-sm text-muted-foreground">{l}</div>
          </div>
        ))}
      </div>
    </div>,

    // 2 — Private scoring flow
    <div key="flow">
      <SectionLabel>The mechanism</SectionLabel>
      <h2 className="max-w-2xl font-display text-3xl font-bold tracking-tight sm:text-5xl">The data goes in. Only a signed grade comes out.</h2>
      <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">
        Encrypted buyer data is scored inside a Flare Compute Extension. The enclave signs the grade with its attested key — the raw
        financials and the debtor&apos;s identity never touch the chain.
      </p>
      <div className="mt-8 overflow-x-auto rounded-2xl border border-border bg-card/40 p-4">
        <PrivateScoringFlow />
      </div>
    </div>,

    // 3 — Pipeline
    <div key="pipeline">
      <SectionLabel>The lifecycle</SectionLabel>
      <h2 className="font-display text-3xl font-bold tracking-tight sm:text-5xl">Five steps, every one on Flare.</h2>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { icon: Coins, t: "Register", s: "One XRPL payment via Smart Accounts — no EVM wallet.", p: "Smart Accounts" },
          { icon: Lock, t: "Score", s: "Buyer data scored privately inside the TEE.", p: "Compute Extension" },
          { icon: FileSignature, t: "Attest", s: "The signed grade is minted as an attestation NFT.", p: "ERC-721" },
          { icon: Banknote, t: "Fund", s: "Funders advance discounted FXRP from a tranche vault.", p: "FAssets · FTSO" },
          { icon: ShieldCheck, t: "Settle", s: "FDC proves repayment — or certifies default.", p: "FDC" },
        ].map((x, idx) => (
          <div key={x.t} className="rounded-2xl border border-border bg-card/60 p-5">
            <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-primary/12 text-primary"><x.icon className="h-5 w-5" /></div>
            <div className="text-xs text-muted-foreground">Step {idx + 1}</div>
            <div className="font-semibold">{x.t}</div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{x.s}</p>
            <div className="mt-3 inline-block rounded-full border border-primary/25 px-2 py-0.5 text-[11px] text-primary">{x.p}</div>
          </div>
        ))}
      </div>
    </div>,

    // 4 — Capital cycle
    <div key="capital">
      <SectionLabel>The capital cycle</SectionLabel>
      <h2 className="max-w-2xl font-display text-3xl font-bold tracking-tight sm:text-5xl">Funders earn the spread. Junior takes first loss.</h2>
      <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">
        A senior/junior FXRP vault prices capital against each grade. The supplier gets instant liquidity; funders earn yield when the
        buyer settles; the junior tranche absorbs losses first if they don&apos;t.
      </p>
      <div className="mt-8 overflow-x-auto rounded-2xl border border-border bg-card/40 p-4">
        <CapitalCycleFlow />
      </div>
    </div>,

    // 5 — Primitives
    <div key="primitives">
      <SectionLabel>Flare, load-bearing</SectionLabel>
      <h2 className="font-display text-3xl font-bold tracking-tight sm:text-5xl">Five primitives, none of them decorative.</h2>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { t: "Compute Extension (TEE)", s: "Decrypts and scores debtor data privately; signs only the grade. This is the product." },
          { t: "FXRP / FAssets", s: "The settlement asset — deposited, advanced, redeemable to native XRP. One chain, no second token." },
          { t: "Smart Accounts", s: "XRPL-native registration and FXRP receipt with no EVM wallet — one XRPL payment does it all." },
          { t: "FDC — three types", s: "Web2Json sources the jurisdiction input and anchors a payment-history provenance commitment; Payment confirms settlement; ReferencedPaymentNonexistence certifies default." },
          { t: "FTSO", s: "Prices vault NAV and shares in USD from the live XRP/USD feed — continuous, not a one-off lookup." },
          { t: "Transparent formula", s: "Published weighted model — repayment, relationship size, tenor, jurisdiction. Auditable logic, private inputs." },
        ].map((x) => (
          <div key={x.t} className="rounded-2xl border border-border bg-card/60 p-5">
            <div className="font-semibold text-primary">{x.t}</div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{x.s}</p>
          </div>
        ))}
      </div>
    </div>,

    // 6 — Trust boundary
    <div key="trust">
      <SectionLabel>The trust boundary, stated plainly</SectionLabel>
      <h2 className="font-display text-3xl font-bold tracking-tight sm:text-5xl">Honest about what stays secret — and what doesn&apos;t.</h2>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-primary/25 bg-primary/[0.05] p-6">
          <div className="mb-3 flex items-center gap-2 text-primary"><Lock className="h-5 w-5" /><span className="font-semibold">Private — inside the TEE</span></div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>· The debtor&apos;s raw payment-history and financials</li>
            <li>· The debtor&apos;s identity</li>
            <li>· The scoring computation itself</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-border bg-card/60 p-6">
          <div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-[color:var(--success,#5bbf8f)]" /><span className="font-semibold">Public — on Flare</span></div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>· A signed categorical grade (A–D) + discount rate</li>
            <li>· A commitment binding the exact invoice + a Web2Json commitment vouching the data&apos;s source</li>
            <li>· FXRP movement, settlement, and default proofs</li>
          </ul>
        </div>
      </div>
      <p className="mt-5 flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
        <Scale className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span>
          What stays trusted, named honestly: the TEE hardware (side-channel risk is real), the data-provider consensus that relays
          instructions, and the model&apos;s <em className="text-foreground/90">honesty</em> — a TEE proves the code ran as deployed, not that
          the model is well-calibrated. &ldquo;Verifiably honest&rdquo; and &ldquo;verifiably accurate&rdquo; are different claims.
        </span>
      </p>
    </div>,

    // 7 — Beyond the hackathon (credible path)
    <div key="beyond">
      <SectionLabel>Beyond the hackathon</SectionLabel>
      <h2 className="font-display text-3xl font-bold tracking-tight sm:text-5xl">A credible path past the demo.</h2>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card/60 p-6">
          <div className="mb-3 font-semibold text-primary">Roadmap</div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>· <span className="text-foreground">v2 shipped</span> — real buyer data via a Web2Json provenance commitment (proven live)</li>
            <li>· <span className="text-foreground">v3</span> — a published, governance-set, versioned scoring-model spec</li>
            <li>· Authenticated accounting-API integration behind the same provenance commitment</li>
            <li>· Production TEE (GCP Confidential Space), timelock governance, persisted enclave identity</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-border bg-card/60 p-6">
          <div className="mb-3 font-semibold text-primary">How it earns</div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>· <span className="text-foreground">Origination fee</span> per factored invoice</li>
            <li>· <span className="text-foreground">Protocol take-rate</span> on the yield spread — what buyers effectively pay vs. what funders receive</li>
            <li>· <span className="text-foreground">Premium tier</span> — score a buyer without even encrypted references leaving the supplier&apos;s own infrastructure (bring-your-own-key)</li>
          </ul>
        </div>
      </div>
      <p className="mt-6 max-w-3xl leading-relaxed text-muted-foreground">
        The market is <span className="text-foreground">$2.5&nbsp;trillion</span>, and the wedge is <span className="text-foreground">privacy</span> — the
        one thing legacy factoring structurally can&apos;t offer. Cifra is the only version that keeps scoring, funding, and settlement
        <span className="text-foreground"> Flare-native end-to-end</span>, so the TEE-signed grade the whole product hinges on never has to leave the chain it settles on.
      </p>
    </div>,

    // 8 — Everything, Flare-native (recap + full-loop flow)
    <div key="loop">
      <SectionLabel>Everything, Flare-native</SectionLabel>
      <h2 className="max-w-2xl font-display text-3xl font-bold tracking-tight sm:text-5xl">One loop. Every piece live on Coston2.</h2>
      <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">
        Private TEE scoring, FXRP settlement, XRPL-native onboarding, senior/junior tranches, FDC-proven settlement and default, and
        real buyer-data provenance through Web2Json — one continuous loop, and every step is a verifiable transaction today.
      </p>
      <div className="mt-8 overflow-x-auto rounded-2xl border border-border bg-card/40 p-4">
        <FullLoopFlow />
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {["Private TEE scoring", "FXRP settlement", "XRPL-native onboarding", "Senior/junior tranches", "FDC settle & default", "Web2Json provenance"].map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--success,#5bbf8f)]/30 bg-[color:var(--success,#5bbf8f)]/[0.06] px-3 py-1 text-xs text-muted-foreground">
            <Check className="h-3 w-3 text-[color:var(--success,#5bbf8f)]" /> {c}
          </span>
        ))}
      </div>
    </div>,

    // 9 — The close
    <div key="close" className="text-center">
      <h2 className="mx-auto max-w-4xl font-display text-4xl font-black leading-[0.95] tracking-tight text-white sm:text-6xl">
        The only one that keeps the entire loop —<br />
        <span className="text-primary">TEE scoring and invoices — Flare-native.</span>
      </h2>
      <p className="mx-auto mt-6 max-w-2xl leading-relaxed text-white/60">
        Private credit scoring in a Flare TEE · FXRP settlement · XRPL-native onboarding · senior/junior tranches · FDC-proven
        settlement &amp; default · real buyer-data provenance via Web2Json.
      </p>
      <p className="mt-6 text-lg font-semibold text-[color:var(--success,#5bbf8f)]">Every piece is live on Coston2 today.</p>
      <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
        <Link href="/onboard"><Button size="lg" className="h-13 px-7 font-bold">Onboard an invoice <ArrowRight className="h-4 w-4" /></Button></Link>
        <Link href="/dashboard"><Button size="lg" variant="outline" className="h-13 px-7 font-bold">Provide liquidity</Button></Link>
      </div>
    </div>,
  ];
}
