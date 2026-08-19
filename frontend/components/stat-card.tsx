import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  sub,
  accent,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn("relative overflow-hidden", className)}>
      {accent && (
        <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-primary/20 blur-2xl" />
      )}
      <CardTitle>{label}</CardTitle>
      <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-sm text-muted-foreground">{sub}</div>}
    </Card>
  );
}
