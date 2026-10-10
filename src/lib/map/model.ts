// Map of colonias: URL filters, metrics, color scale and CSV. Pure: shared by
// the server page, the client map and unit tests.
import { z } from "zod";
import { nss } from "../dashboard/model.ts";
import { SENTIMENTS, type Sentiment } from "../inbox/model.ts";

// ---------------------------------------------------------------------------
// Filters (?tema&dependencia&sentimiento&colonia&metrica, plus the period)
// ---------------------------------------------------------------------------

export const METRIC_KEYS = ["quejas", "menciones", "negativo", "nss", "cambio"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

const guid = z.guid();
const optional = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

const filtersSchema = z.object({
  tema: optional(z.string().trim().min(1).max(80)),
  dependencia: optional(guid),
  sentimiento: optional(z.enum(SENTIMENTS)),
  colonia: optional(guid),
  metrica: z.enum(METRIC_KEYS).catch("quejas"),
});
export type MapFilters = z.infer<typeof filtersSchema>;
const FILTER_KEYS = ["tema", "dependencia", "sentimiento", "colonia", "metrica"] as const;
const PERIOD_KEYS = ["periodo", "desde", "hasta"] as const;

const first = (v: string | string[] | undefined | null) => (Array.isArray(v) ? v[0] : (v ?? undefined));

/** Reads map filters from URL params, dropping anything malformed. */
export function parseMapFilters(params: Record<string, string | string[] | undefined> | URLSearchParams): MapFilters {
  const get = (key: string) => (params instanceof URLSearchParams ? params.get(key) : first(params[key]));
  return filtersSchema.parse(Object.fromEntries(FILTER_KEYS.map((k) => [k, get(k) || undefined])));
}

/**
 * /mapa URL from the current params with some keys changed (null removes).
 * Keeps the period; the default metric is left out of the URL.
 */
export function mapHref(current: URLSearchParams, changes: Partial<Record<(typeof FILTER_KEYS)[number], string | null>>): string {
  const next = new URLSearchParams();
  for (const key of [...PERIOD_KEYS, ...FILTER_KEYS]) {
    const value = key in changes ? changes[key as keyof typeof changes] : current.get(key);
    if (value && !(key === "metrica" && value === "quejas")) next.set(key, value);
  }
  const s = next.toString();
  return s ? `/mapa?${s}` : "/mapa";
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export type MapRow = {
  id: string;
  name: string;
  approx: boolean;
  total: number;
  complaints: number;
  positive: number;
  neutral: number;
  negative: number;
  prevTotal: number;
  prevComplaints: number;
  prevClassified: number;
  prevPositive: number;
  prevNegative: number;
  topics: { topic: string; total: number }[];
};

export type MapStats = { rows: MapRow[]; unassigned: number; total: number; topics: string[] };

const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : 0);

/** Joins map_stats with the catalog: every colonia with a polygon gets a row, with zeros when quiet. */
export function buildMapStats(
  raw: Record<string, unknown> | null,
  colonias: { id: string; name: string; approx: boolean }[],
): MapStats {
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of (raw?.neighborhoods as Record<string, unknown>[] | undefined) ?? []) byId.set(String(r.id), r);
  const rows = colonias.map((c): MapRow => {
    const r = byId.get(c.id) ?? {};
    return {
      ...c,
      total: n(r.total),
      complaints: n(r.complaints),
      positive: n(r.positive),
      neutral: n(r.neutral),
      negative: n(r.negative),
      prevTotal: n(r.prev_total),
      prevComplaints: n(r.prev_complaints),
      prevClassified: n(r.prev_classified),
      prevPositive: n(r.prev_positive),
      prevNegative: n(r.prev_negative),
      topics: Array.isArray(r.topics)
        ? (r.topics as Record<string, unknown>[]).map((t) => ({ topic: String(t.topic), total: n(t.total) }))
        : [],
    };
  });
  return {
    rows,
    unassigned: n(raw?.unassigned),
    total: n(raw?.total),
    topics: Array.isArray(raw?.topics) ? (raw.topics as unknown[]).map(String) : [],
  };
}

export const classified = (r: MapRow) => r.positive + r.neutral + r.negative;

/** Below this many classified mentions a rate (% negative, NSS) is not shown: too noisy. */
export const MIN_FOR_RATE = 3;

export type MetricDef = {
  label: string;
  /** Legend and tooltip unit. */
  describe: (v: number) => string;
  /** sequential: 0 → max in one hue; diverging: negative ↔ positive around 0. */
  scale: "sequential" | "diverging";
  /** For diverging scales, whether values above zero are good (green). */
  positiveIsGood?: boolean;
  value: (r: MapRow) => number | null;
  help: string;
};

const integer = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
const signedInt = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0, signDisplay: "exceptZero" });
const plural = (v: number, one: string, many: string) => `${integer.format(v)} ${Math.abs(v) === 1 ? one : many}`;

export const METRICS: Record<MetricKey, MetricDef> = {
  quejas: {
    label: "Quejas",
    describe: (v) => plural(v, "queja", "quejas"),
    scale: "sequential",
    value: (r) => r.complaints,
    help: "Quejas y denuncias del periodo.",
  },
  menciones: {
    label: "Menciones",
    describe: (v) => plural(v, "mención", "menciones"),
    scale: "sequential",
    value: (r) => r.total,
    help: "Todas las menciones del periodo.",
  },
  negativo: {
    label: "% negativo",
    describe: (v) => `${integer.format(v)} % negativas`,
    scale: "sequential",
    value: (r) => (classified(r) >= MIN_FOR_RATE ? (r.negative / classified(r)) * 100 : null),
    help: `Parte de las menciones clasificadas que son negativas (con ${MIN_FOR_RATE} o más).`,
  },
  nss: {
    label: "Sentimiento neto",
    describe: (v) => `NSS ${signedInt.format(v)}`,
    scale: "diverging",
    positiveIsGood: true,
    value: (r) => (classified(r) >= MIN_FOR_RATE ? nss(r.positive, r.negative, classified(r)) : null),
    help: "Positivas menos negativas sobre clasificadas (−100 a +100).",
  },
  cambio: {
    label: "Cambio en quejas",
    describe: (v) => `${signedInt.format(v)} quejas vs. periodo anterior`,
    scale: "diverging",
    positiveIsGood: false,
    value: (r) => r.complaints - r.prevComplaints,
    help: "Quejas de este periodo menos las del anterior. Rojo: empeoró.",
  },
};

/** Largest absolute value of a metric (≥ 1), the end of the color scale. */
export function scaleMax(rows: MapRow[], metric: MetricKey): number {
  if (metric === "negativo") return 100;
  if (metric === "nss") return 100;
  return Math.max(1, ...rows.map((r) => Math.abs(METRICS[metric].value(r) ?? 0)));
}

/** Colonias ordered for the ranking: worst first (most complaints, most negative, biggest rise; lowest NSS). */
export function rankRows(rows: MapRow[], metric: MetricKey): MapRow[] {
  const v = (r: MapRow) => METRICS[metric].value(r);
  return rows
    .filter((r) => v(r) !== null && (metric === "cambio" ? v(r) !== 0 || r.complaints > 0 : r.total > 0))
    .sort((a, b) => (metric === "nss" ? v(a)! - v(b)! : v(b)! - v(a)!) || b.total - a.total || a.name.localeCompare(b.name, "es"));
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const csvCell = (v: string | number) => {
  const s = String(v);
  // Quotes, separators and spreadsheet formulas are neutralized.
  const safe = /^[=+\-@]/.test(s) && typeof v === "string" ? `'${s}` : s;
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function mapCsv(rows: MapRow[]): string {
  const header = [
    "Colonia",
    "Menciones",
    "Quejas",
    "Positivas",
    "Neutrales",
    "Negativas",
    "% negativo",
    "NSS",
    "Quejas periodo anterior",
    "Cambio en quejas",
    "Temas principales",
    "Polígono",
  ];
  const lines = rows.map((r) => {
    const neg = METRICS.negativo.value(r);
    const score = METRICS.nss.value(r);
    return [
      r.name,
      r.total,
      r.complaints,
      r.positive,
      r.neutral,
      r.negative,
      neg === null ? "" : Math.round(neg * 10) / 10,
      score === null ? "" : Math.round(score),
      r.prevComplaints,
      r.complaints - r.prevComplaints,
      r.topics.map((t) => t.topic).join(" / "),
      r.approx ? "aproximado" : "trazado",
    ].map(csvCell).join(",");
  });
  // BOM so Excel opens accents correctly.
  return `﻿${[header.map(csvCell).join(","), ...lines].join("\n")}\n`;
}

export const SENTIMENT_FILTER_LABELS: Record<Sentiment, string> = {
  positive: "Positivas",
  neutral: "Neutrales",
  negative: "Negativas",
};
