import { cn } from "@/lib/utils";

/**
 * Invoice lifecycle state, drawn as geometry rather than colour alone.
 *
 * Every state differs from every other by SHAPE — ring, half-ring, filled, split, cross — not
 * just hue. That is what keeps it readable for colour-blind users and under
 * `prefers-reduced-motion`, and it is a correctness requirement rather than a nicety here:
 * "Funded" versus "Defaulted" is the difference between an asset and a loss.
 *
 * Nothing animates toward a value. The state appears when the on-chain event that produced it
 * lands, because an interpolated status would be a claim the chain has not made yet.
 */
const STATES = {
  Registered: { label: "Registered", tone: "text-muted-foreground", ring: "border-current", fill: "none" },
  Scored: { label: "Scored", tone: "text-primary", ring: "border-current", fill: "half" },
  Funded: { label: "Funded", tone: "text-[color:var(--success)]", ring: "border-current", fill: "full" },
  Settled: { label: "Settled", tone: "text-[color:var(--success)]", ring: "border-current", fill: "check" },
  Defaulted: { label: "Defaulted", tone: "text-[color:var(--destructive)]", ring: "border-current", fill: "cross" },
  Overdue: { label: "Overdue", tone: "text-[color:var(--warning)]", ring: "border-current border-dashed", fill: "full" },
} as const;

export type InvoiceState = keyof typeof STATES;

export function StatusDot({ state, className }: { state: InvoiceState; className?: string }) {
  const s = STATES[state] ?? STATES.Registered;
  return (
    <span className={cn("inline-flex items-center gap-2 text-xs font-medium", s.tone, className)}>
      <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0" aria-hidden="true">
        <circle
          cx="6"
          cy="6"
          r="5"
          // "check" must fill too: the tick is drawn in the background colour, so on an unfilled
          // circle it is invisible and Settled becomes indistinguishable from Registered.
          fill={s.fill === "full" || s.fill === "check" ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray={state === "Overdue" ? "2 1.5" : undefined}
        />
        {s.fill === "half" && <path d="M6 1 A5 5 0 0 1 6 11 Z" fill="currentColor" />}
        {s.fill === "check" && <path d="M3.5 6.2 5.2 8 8.5 4.2" fill="none" stroke="var(--background)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
        {s.fill === "cross" && <path d="M4 4 8 8 M8 4 4 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
      </svg>
      {s.label}
    </span>
  );
}

/** Map registry status + due date onto a display state. */
export function invoiceState(status: string, attested: boolean, dueDate: number): InvoiceState {
  if (status === "Settled") return "Settled";
  if (status === "Defaulted") return "Defaulted";
  if (status === "Funded") return Date.now() / 1000 > dueDate ? "Overdue" : "Funded";
  return attested ? "Scored" : "Registered";
}
