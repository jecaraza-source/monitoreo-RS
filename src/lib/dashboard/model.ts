// Dashboard data shapes and derived metrics. Pure: shared by the server page,
// the client charts and unit tests.
import { filtersToSearch, type InboxFilters, type Sentiment } from "../inbox/model.ts";

export type Totals = {
  mentions: number;
  classified: number;
  positive: number;
  neutral: number;
  negative: number;
  interactions: number;
  openTickets: number;
  resolvedTickets: number;
  /** Mean hours from routing to resolution; null when nothing was resolved. */
  attentionHours: number | null;
};

export type SeriesPoint = { bucket: string; positive: number; neutral: number; negative: number; pending: number };
export type SentimentSlice = { total: number; positive: number; negative: number };
export type TopicRow = SentimentSlice & { topic: string; nss: number };
export type DepartmentRow = SentimentSlice & { id: string; name: string; nss: number };
export type NeighborhoodRow = { id: string; total: number; complaints: number; negative: number };
export type TopMention = {
  id: string;
  text: string;
  url: string | null;
  publishedAt: string;
  /** "Facebook · Página oficial…", resolved by the caller from source_id. */
  source: string | null;
  author: string | null;
  authorKind: string | null;
  sentiment: Sentiment | null;
  interactions: number;
};
export type MediaRow = { id: string; name: string; kind: string; mentions: number; interactions: number; nss: number };

export type DashboardData = {
  totals: Totals;
  previous: Totals;
  series: SeriesPoint[];
  topics: TopicRow[];
  departments: DepartmentRow[];
  neighborhoods: NeighborhoodRow[];
  topMentions: TopMention[];
  topMedia: MediaRow[];
};

const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : 0);

/** Net Sentiment Score: (positive − negative) / classified × 100. */
export function nss(positive: number, negative: number, classified: number): number {
  return classified > 0 ? ((positive - negative) / classified) * 100 : 0;
}

export function negativeShare(t: Pick<Totals, "negative" | "classified">): number {
  return t.classified > 0 ? (t.negative / t.classified) * 100 : 0;
}

type Raw = Record<string, unknown>;

export function parseTotals(raw: Raw | undefined): Totals {
  const t = raw ?? {};
  return {
    mentions: n(t.mentions),
    classified: n(t.classified),
    positive: n(t.positive),
    neutral: n(t.neutral),
    negative: n(t.negative),
    interactions: n(t.interactions),
    openTickets: n(t.open_tickets),
    resolvedTickets: n(t.resolved_tickets),
    attentionHours: t.attention_hours == null ? null : n(t.attention_hours),
  };
}

/** Sentiment-only slices: NSS over the classified ones (positive+neutral+negative = total here). */
function slice(r: Raw): SentimentSlice & { nss: number } {
  const total = n(r.total);
  const positive = n(r.positive);
  const negative = n(r.negative);
  return { total, positive, negative, nss: nss(positive, negative, total) };
}

/** Ascending NSS (worst first), keeping only the `limit` with most mentions. */
export function byNss<T extends { total: number; nss: number }>(rows: T[], limit = 8): T[] {
  return [...rows].sort((a, b) => b.total - a.total).slice(0, limit).sort((a, b) => a.nss - b.nss || b.total - a.total);
}

export function parseDashboard(
  current: Raw,
  previous: Raw,
  departmentNames: Map<string, string>,
  sourceNames: Map<string, string> = new Map(),
): DashboardData {
  const list = (key: string) => (Array.isArray(current[key]) ? (current[key] as Raw[]) : []);
  return {
    totals: parseTotals(current.totals as Raw),
    previous: parseTotals(previous.totals as Raw),
    series: list("series").map((r) => ({
      bucket: String(r.bucket),
      positive: n(r.positive),
      neutral: n(r.neutral),
      negative: n(r.negative),
      pending: n(r.pending),
    })),
    topics: byNss(list("topics").map((r) => ({ topic: String(r.topic), ...slice(r) }))),
    departments: byNss(
      list("departments").map((r) => ({ id: String(r.id), name: departmentNames.get(String(r.id)) ?? "Sin nombre", ...slice(r) })),
    ),
    neighborhoods: list("neighborhoods").map((r) => ({
      id: String(r.id),
      total: n(r.total),
      complaints: n(r.complaints),
      negative: n(r.negative),
    })),
    topMentions: list("top_mentions").map((r) => ({
      id: String(r.id),
      text: String(r.text ?? ""),
      url: (r.url as string | null) ?? null,
      publishedAt: String(r.published_at),
      source: sourceNames.get(String(r.source_id)) ?? null,
      author: (r.display_name as string | null) ?? (r.handle ? `@${r.handle}` : null),
      authorKind: (r.kind as string | null) ?? null,
      sentiment: (r.sentiment as Sentiment | null) ?? null,
      interactions: n(r.interactions),
    })),
    topMedia: list("top_media").map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ""),
      kind: String(r.kind ?? "media"),
      mentions: n(r.mentions),
      interactions: n(r.interactions),
      nss: nss(n(r.positive), n(r.negative), n(r.mentions)),
    })),
  };
}

/**
 * Up to `count` peaks of total volume: buckets clearly above the typical one
 * (1.5× the median) and not next to an already chosen peak.
 */
export function findPeaks(series: SeriesPoint[], count = 2): number[] {
  const totals = series.map((p) => p.positive + p.neutral + p.negative + p.pending);
  const sorted = [...totals].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const picked: number[] = [];
  for (const i of totals.map((_, i) => i).sort((a, b) => totals[b] - totals[a])) {
    if (picked.length >= count) break;
    if (totals[i] === 0 || totals[i] < median * 1.5) break;
    if (picked.some((p) => Math.abs(p - i) <= 1)) continue;
    picked.push(i);
  }
  return picked.sort((a, b) => a - b);
}

/** Link to the inbox with the dashboard's period plus extra filters. */
export function inboxHref(period: { fromDay: string; toDay: string }, filters: InboxFilters = {}): string {
  return `/bandeja${filtersToSearch({ from: period.fromDay, to: period.toDay, status: "all", ...filters })}`;
}
