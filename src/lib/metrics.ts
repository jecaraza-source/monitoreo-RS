// Period-over-period comparison for KPIs. Pure, shared by UI and tests.

export type Trend = "up" | "down" | "flat";
export type Tone = "positive" | "negative" | "neutral";

export type Delta = {
  /** Relative change (0.12 = +12 %). Null when there is no baseline to compare. */
  ratio: number | null;
  trend: Trend;
};

/** Changes smaller than this (0.5 %) read as "no change". */
const FLAT_THRESHOLD = 0.005;

export function computeDelta(current: number, previous: number | null | undefined): Delta {
  if (previous == null || !Number.isFinite(previous)) return { ratio: null, trend: "flat" };
  if (previous === 0) {
    return { ratio: null, trend: current === 0 ? "flat" : current > 0 ? "up" : "down" };
  }
  const ratio = (current - previous) / Math.abs(previous);
  if (Math.abs(ratio) < FLAT_THRESHOLD) return { ratio: 0, trend: "flat" };
  return { ratio, trend: ratio > 0 ? "up" : "down" };
}

/**
 * Semantic color of a trend. For metrics where growth is bad (negative
 * mentions, response time) pass higherIsBetter = false.
 */
export function trendTone(trend: Trend, higherIsBetter = true): Tone {
  if (trend === "flat") return "neutral";
  return (trend === "up") === higherIsBetter ? "positive" : "negative";
}

const percent = new Intl.NumberFormat("es-MX", {
  style: "percent",
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

/** "+12.5 %", "−3 %", "0 %" or "—" without a baseline. */
export function formatDelta(delta: Delta): string {
  return delta.ratio == null ? "—" : percent.format(delta.ratio);
}
