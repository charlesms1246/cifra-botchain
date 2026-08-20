"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { WalletButton } from "@/components/wallet-button";
import { activeChain } from "@/lib/chain";

const NAV = [
  { href: "/dashboard", label: "Fund" },
  { href: "/marketplace", label: "Invoices" },
  { href: "/onboard", label: "Factor" },
  { href: "/pitch", label: "How it works" },
];

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-5">
        <Link href="/" className="flex shrink-0 items-center" aria-label="Cifra home">
          <Image src="/cifra/Cifra_text.svg" alt="Cifra" width={90} height={32} className="h-6 w-auto" priority />
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-widest transition-colors",
                isActive(n.href) ? "text-foreground bg-white/[0.06]" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {activeChain.testnet && (
            <span className="hidden rounded-full border border-[color:var(--warning)]/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--warning)] md:inline">
              Testnet
            </span>
          )}
          <WalletButton />
          {/* Without this the entire navigation vanished below the `sm` breakpoint. */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground sm:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-border bg-background/95 px-4 py-2 sm:hidden">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              className={cn(
                "block rounded-lg px-3 py-3 text-sm font-semibold",
                isActive(n.href) ? "bg-white/[0.06] text-foreground" : "text-muted-foreground"
              )}
            >
              {n.label}
            </Link>
          ))}
          {activeChain.testnet && (
            <p className="px-3 py-2 text-xs text-[color:var(--warning)]">Connected to {activeChain.name}</p>
          )}
        </nav>
      )}
    </header>
  );
}
