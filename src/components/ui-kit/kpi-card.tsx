import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { computeDelta, formatDelta, trendTone, type Tone } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "./animated-number";
import { Reveal } from "./reveal";

const TONE_CLASS: Record<Tone, string> = {
  positive: "bg-positive/12 text-positive",
  negative: "bg-negative/12 text-negative",
  neutral: "bg-muted text-muted-foreground",
};

const TREND_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight };

export type KpiCardProps = {
  label: string;
  value: number;
  /** Same metric in the previous period; omit to hide the comparison. */
  previousValue?: number | null;
  formatOptions?: Intl.NumberFormatOptions;
  /** False for metrics where growth is bad (negative mentions, response time). */
  higherIsBetter?: boolean;
  icon?: React.ReactNode;
  comparisonLabel?: string;
  /** Stagger index for the entry animation in a row of cards. */
  index?: number;
  className?: string;
};

export function KpiCard({
  label,
  value,
  previousValue,
  formatOptions,
  higherIsBetter = true,
  icon,
  comparisonLabel = "vs. periodo anterior",
  index = 0,
  className,
}: KpiCardProps) {
  const showDelta = previousValue !== undefined;
  const delta = computeDelta(value, previousValue);
  const tone = trendTone(delta.trend, higherIsBetter);
  const TrendIcon = TREND_ICON[delta.trend];

  return (
    <Reveal delay={index * 0.06} className={cn("h-full", className)}>
      <Card className="h-full">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle as="h3" className="text-sm font-medium text-muted-foreground">
            {label}
          </CardTitle>
          {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <AnimatedNumber
            value={value}
            formatOptions={formatOptions}
            className="text-3xl font-semibold tracking-tight"
          />
          {showDelta && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium tabular-nums",
                  TONE_CLASS[tone],
                )}
              >
                <TrendIcon aria-hidden className="size-3.5" />
                {formatDelta(delta)}
              </span>
              {comparisonLabel}
            </p>
          )}
        </CardContent>
      </Card>
    </Reveal>
  );
}
