import { cn } from "@/lib/utils";

const GRADE_STYLES: Record<string, string> = {
  A: "border-[color:var(--success)]/40 text-[color:var(--success)] bg-[color:var(--success)]/10",
  B: "border-primary/40 text-primary bg-primary/10",
  C: "border-[color:var(--warning)]/40 text-[color:var(--warning)] bg-[color:var(--warning)]/10",
  D: "border-[color:var(--destructive)]/40 text-[color:var(--destructive)] bg-[color:var(--destructive)]/10",
};

/** Signed risk grade pill. Muted "Unscored" state when no grade has been attested. */
export function RiskBadge({ grade, className }: { grade: string; className?: string }) {
  const g = (grade || "").toUpperCase();
  const style = GRADE_STYLES[g];
  if (!style) {
    return (
      <span
        className={cn(
          "inline-flex h-8 items-center justify-center rounded-lg border border-dashed border-border px-2.5 text-xs font-medium text-muted-foreground",
          className
        )}
        title="Not yet scored"
      >
        Unscored
      </span>
    );
  }
  return (
    <span
      className={cn("inline-flex h-8 min-w-8 items-center justify-center rounded-lg border px-2 text-sm font-bold tabular-nums", style, className)}
      title={`Signed grade ${g}`}
    >
      {g}
    </span>
  );
}
