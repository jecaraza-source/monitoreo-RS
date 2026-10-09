import { cn } from "@/lib/utils";
import type { Database } from "@/lib/supabase/database.types";

export type Sentiment = Database["public"]["Enums"]["sentiment"];

// Color lives in the dot, tint and ring; the label stays in text ink so the
// badge keeps AA contrast (sentiment hues on their own tint fall near 4.2:1).
const SENTIMENT: Record<Sentiment, { label: string; className: string; dot: string }> = {
  positive: { label: "Positivo", className: "bg-positive/12 ring-positive/30", dot: "bg-positive" },
  neutral: { label: "Neutral", className: "bg-neutral/12 ring-neutral/30", dot: "bg-neutral" },
  negative: { label: "Negativo", className: "bg-negative/12 ring-negative/30", dot: "bg-negative" },
};

const confidence = new Intl.NumberFormat("es-MX", { style: "percent", maximumFractionDigits: 0 });

export function SentimentBadge({
  sentiment,
  confidence: score,
  className,
}: {
  sentiment: Sentiment;
  /** Model confidence 0–1, shown next to the label. */
  confidence?: number | null;
  className?: string;
}) {
  const { label, className: tone, dot } = SENTIMENT[sentiment];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium text-foreground ring-1 ring-inset",
        tone,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", dot)} />
      {label}
      {score != null && (
        <span className="tabular-nums opacity-70" title="Confianza del modelo">
          {confidence.format(score)}
        </span>
      )}
    </span>
  );
}
