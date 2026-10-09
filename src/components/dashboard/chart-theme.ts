// Shared Recharts styling: hairline grid, muted axes, theme tokens.
export const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 };

export const TOOLTIP_STYLE = {
  contentStyle: {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    color: "var(--popover-foreground)",
    fontSize: 12,
  },
  labelStyle: { color: "var(--muted-foreground)" },
} as const;

// Diverging sentiment scale: green / gray midpoint / red (validated with the
// dataviz palette checks against both card surfaces).
export const SENTIMENT_SERIES = [
  { key: "positive", label: "Positivo", color: "var(--positive)" },
  { key: "neutral", label: "Neutral", color: "var(--neutral)" },
  { key: "negative", label: "Negativo", color: "var(--negative)" },
] as const;

const hour = new Intl.DateTimeFormat("es-MX", { hour: "numeric", timeZone: "America/Mexico_City" });
const day = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" });
const dayHour = new Intl.DateTimeFormat("es-MX", {
  weekday: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Mexico_City",
});
const longDay = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Mexico_City" });

export function bucketTick(iso: string, bucket: "hour" | "day"): string {
  return bucket === "hour" ? `${hour.format(new Date(iso))} h` : day.format(new Date(iso));
}

export function bucketLabel(iso: string, bucket: "hour" | "day"): string {
  return bucket === "hour" ? dayHour.format(new Date(iso)) : longDay.format(new Date(iso));
}

const nf = new Intl.NumberFormat("es-MX");
export const formatNumber = (v: number) => nf.format(v);

/** Row height of the horizontal NSS bars; the card height derives from it. */
export const NSS_ROW_HEIGHT = 34;
