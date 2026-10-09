import { cn } from "@/lib/utils";
import type { Database } from "@/lib/supabase/database.types";

export type Sentiment = Database["public"]["Enums"]["sentiment"];

const SENTIMENT: Record<Sentiment, { label: string; className: string }> = {
  positive: { label: "Positivo", className: "bg-positive/12 text-positive ring-positive/25" },
  neutral: { label: "Neutral", className: "bg-neutral/12 text-neutral ring-neutral/25" },
  negative: { label: "Negativo", className: "bg-negative/12 text-negative ring-negative/25" },
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
  const { label, className: tone } = SENTIMENT[sentiment];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        tone,
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {label}
      {score != null && (
        <span className="tabular-nums opacity-70" title="Confianza del modelo">
          {confidence.format(score)}
        </span>
      )}
    </span>
  );
}
