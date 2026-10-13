import type { Tone } from "@/lib/health/model";
import { cn } from "@/lib/utils";

// Warn and info use the default palette: the theme only defines sentiment colors.
export const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-positive/12 text-positive",
  info: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  warn: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  error: "bg-negative/12 text-negative",
  muted: "bg-muted text-muted-foreground",
};

export const TONE_BORDER: Record<Tone, string> = {
  ok: "border-positive/30",
  info: "border-sky-500/30",
  warn: "border-amber-500/40",
  error: "border-negative/40",
  muted: "border-border",
};

export function StatusBadge({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium", TONE_CLASS[tone], className)}>
      {children}
    </span>
  );
}
