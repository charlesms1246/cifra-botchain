"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { WalletButton } from "@/components/wallet-button";

const NAV = [
  { href: "/dashboard", label: "Fund" },
  { href: "/marketplace", label: "Invoices" },
  { href: "/onboard", label: "Onboard" },
  { href: "/pitch", label: "Pitch" },
];

export function Header() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link href="/" className="flex items-center" aria-label="Cifra home">
          <Image src="/cifra/Cifra_text.svg" alt="Cifra" width={90} height={32} className="h-6 w-auto" priority />
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {NAV.map((n) => {
            const active = pathname === n.href || pathname.startsWith(n.href + "/");
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-widest transition-colors",
                  active ? "text-foreground bg-white/[0.06]" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>

        <WalletButton />
      </div>
    </header>
  );
}
