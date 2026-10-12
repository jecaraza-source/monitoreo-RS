// Perception of officials: parses officials_stats() and derives the figures
// the dashboard shows. Pure, so it is unit-tested without a database.

export type DailyPoint = { day: string; positive: number; neutral: number; negative: number };

export type OfficialStats = {
  id: string;
  name: string;
  position: string;
  mentions: number;
  positive: number;
  neutral: number;
  negative: number;
  interactions: number;
  /** Net Sentiment Score, −100…100: (positive − negative) / mentions. */
  nss: number;
  /** Share of negative mentions, 0…100. */
  negativePct: number;
  previous: { mentions: number; positive: number; negative: number; nss: number; negativePct: number };
  daily: DailyPoint[];
  topics: { topic: string; mentions: number; negative: number }[];
  emotions: { emotion: string; mentions: number }[];
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

export const nss = (positive: number, negative: number, total: number) =>
  total > 0 ? Math.round(((positive - negative) / total) * 100) : 0;
export const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0);

export function parseOfficials(raw: unknown): OfficialStats[] {
  const list = arr((raw as { officials?: unknown } | null)?.officials);
  return list.map((o) => {
    const mentions = num(o.mentions);
    const positive = num(o.positive);
    const negative = num(o.negative);
    const prevMentions = num(o.prev_mentions);
    const prevPositive = num(o.prev_positive);
    const prevNegative = num(o.prev_negative);
    return {
      id: String(o.id),
      name: String(o.name ?? ""),
      position: String(o.position ?? ""),
      mentions,
      positive,
      neutral: num(o.neutral),
      negative,
      interactions: num(o.interactions),
      nss: nss(positive, negative, mentions),
      negativePct: pct(negative, mentions),
      previous: {
        mentions: prevMentions,
        positive: prevPositive,
        negative: prevNegative,
        nss: nss(prevPositive, prevNegative, prevMentions),
        negativePct: pct(prevNegative, prevMentions),
      },
      daily: arr(o.daily).map((d) => ({
        day: String(d.day),
        positive: num(d.positive),
        neutral: num(d.neutral),
        negative: num(d.negative),
      })),
      topics: arr(o.topics).map((t) => ({ topic: String(t.topic), mentions: num(t.mentions), negative: num(t.negative) })),
      emotions: arr(o.emotions).map((e) => ({ emotion: String(e.emotion), mentions: num(e.mentions) })),
    };
  });
}

export type OfficialsTotals = { mentions: number; negative: number; nss: number; negativePct: number; interactions: number; previous: { mentions: number; nss: number; negativePct: number } };

export function totals(officials: OfficialStats[]): OfficialsTotals {
  const sum = (f: (o: OfficialStats) => number) => officials.reduce((a, o) => a + f(o), 0);
  const mentions = sum((o) => o.mentions);
  const positive = sum((o) => o.positive);
  const negative = sum((o) => o.negative);
  const prevMentions = sum((o) => o.previous.mentions);
  const prevNegative = sum((o) => o.previous.negative);
  const prevPositive = sum((o) => o.previous.positive);
  return {
    mentions,
    negative,
    nss: nss(positive, negative, mentions),
    negativePct: pct(negative, mentions),
    interactions: sum((o) => o.interactions),
    previous: { mentions: prevMentions, nss: nss(prevPositive, prevNegative, prevMentions), negativePct: pct(prevNegative, prevMentions) },
  };
}

/** Comma- or line-separated aliases from the catalog form, trimmed, unique, without "@". */
export function parseAliases(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,\n]/)) {
    const alias = raw.trim().replace(/^@/, "").replace(/\s+/g, " ");
    const key = alias.toLowerCase();
    if (alias.length >= 3 && alias.length <= 80 && !seen.has(key)) {
      seen.add(key);
      out.push(alias);
    }
  }
  return out.slice(0, 20);
}
