import { cn } from "@/lib/utils";

/** Animated shimmer headline text (terracotta → white → terracotta). */
export function ShinyText({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("cifra-shine", className)}>{children}</span>;
}
