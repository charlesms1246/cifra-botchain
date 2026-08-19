import Link from "next/link";
import Image from "next/image";
import { EXPLORER } from "@/lib/chain";

const links = [
  { href: "/dashboard", label: "Fund" },
  { href: "/marketplace", label: "Invoices" },
  { href: "/onboard", label: "Onboard" },
  { href: EXPLORER, label: "Explorer", external: true },
];

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-border px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-6 text-center md:flex-row md:justify-between md:text-left">
        <div className="flex flex-col items-center gap-2 md:items-start">
          <Image src="/cifra/Cifra_text.svg" alt="Cifra" width={72} height={26} className="h-4 w-auto opacity-80" />
          <p className="text-xs text-muted-foreground">
            Private invoice factoring on Flare. Buyer credit, kept private.
          </p>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {links.map((l) =>
            l.external ? (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
              >
                {l.label}
              </a>
            ) : (
              <Link
                key={l.href}
                href={l.href}
                className="text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
              >
                {l.label}
              </Link>
            )
          )}
        </nav>
      </div>
      <p className="mx-auto mt-8 max-w-7xl text-center text-[11px] text-muted-foreground/60 md:text-left">
        © {new Date().getFullYear()} Cifra · Private invoice factoring · Confidential Compute on Flare Coston2
      </p>
    </footer>
  );
}
