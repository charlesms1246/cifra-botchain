"use client";

import { cn } from "@/lib/utils";
import { BOOKS, type Book } from "@/lib/books";

/**
 * Books never mix: an invoice is faced, funded and repaid in one token and the protocol never
 * converts. So this is a hard context switch, not a filter — the UI is always showing exactly
 * one book, and the copy should say which.
 */
export function BookSwitcher({ value, onChange }: { value: Book; onChange: (b: Book) => void }) {
  if (BOOKS.length < 2) return null;
  return (
    <div className="inline-flex rounded-full border border-border bg-black/20 p-1" role="tablist" aria-label="Settlement asset">
      {BOOKS.map((b) => (
        <button
          key={b.key}
          role="tab"
          aria-selected={b.key === value.key}
          onClick={() => onChange(b)}
          className={cn(
            "rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-widest transition-colors",
            b.key === value.key ? "bg-white/[0.08] text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
