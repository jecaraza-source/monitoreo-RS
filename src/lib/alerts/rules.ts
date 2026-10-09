// Alert rules: kinds, parameters, and the decision each rule makes from the
// numbers the database returns. Pure: shared by the evaluator, the rule
// editor and unit tests.
import { z } from "zod";

export const RULE_KINDS = ["spike", "sentiment_drop", "risk_term", "media_negative", "daily_digest"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
export type Severity = "low" | "medium" | "high" | "critical";

export const RULE_KIND_LABELS: Record<RuleKind, string> = {
  spike: "Pico de volumen",
  sentiment_drop: "Caída de sentimiento",
  risk_term: "Término de riesgo",
  media_negative: "Medio o figura pública en contra",
  daily_digest: "Resumen diario",
};

export const RULE_KIND_HELP: Record<RuleKind, string> = {
  spike: "Más menciones de lo normal: la ventana actual supera la media + k desviaciones de los últimos días.",
  sentiment_drop: "El NSS de la ventana cae varios puntos frente al de los últimos días.",
  risk_term: "Una mención recién clasificada contiene un término del catálogo de riesgo.",
  media_negative: "Un medio o una figura pública publica una mención negativa.",
  daily_digest: "Un resumen de las últimas 24 h, una vez al día a la hora indicada.",
};

export const SEVERITY_LABELS: Record<Severity, string> = { critical: "Crítica", high: "Alta", medium: "Media", low: "Baja" };
const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

export const CONDITION_SCHEMAS = {
  spike: z.object({
    window_minutes: int(10, 1440).default(60),
    baseline_days: int(3, 60).default(14),
    k: z.coerce.number().min(1).max(10).default(3),
    min_mentions: int(1, 10000).default(10),
  }),
  sentiment_drop: z.object({
    window_minutes: int(30, 1440).default(180),
    baseline_days: int(3, 60).default(14),
    drop_points: z.coerce.number().min(5).max(200).default(25),
    min_mentions: int(1, 10000).default(10),
  }),
  risk_term: z.object({
    window_minutes: int(5, 1440).default(60),
    min_severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  }),
  media_negative: z.object({
    window_minutes: int(5, 1440).default(60),
  }),
  daily_digest: z.object({
    hour: int(0, 23).default(8),
  }),
} satisfies Record<RuleKind, z.ZodType>;

export type Conditions = { [K in RuleKind]: z.infer<(typeof CONDITION_SCHEMAS)[K]> };

/** Default cooldown per kind: one alert per fingerprint in this many minutes. */
export const DEFAULT_COOLDOWN: Record<RuleKind, number> = {
  spike: 120,
  sentiment_drop: 360,
  risk_term: 360,
  media_negative: 720,
  daily_digest: 1380,
};

/** Reads a stored condition, filling defaults; null when it does not fit the kind. */
export function parseCondition<K extends RuleKind>(kind: K, raw: unknown): Conditions[K] | null {
  const parsed = CONDITION_SCHEMAS[kind].safeParse(raw ?? {});
  return parsed.success ? (parsed.data as Conditions[K]) : null;
}

export function isRuleKind(value: unknown): value is RuleKind {
  return typeof value === "string" && (RULE_KINDS as readonly string[]).includes(value);
}

export const channelsSchema = z.object({
  email: z.array(z.email("Correo inválido.")).max(20).default([]),
  whatsapp: z
    .array(z.string().regex(/^\+\d{10,15}$/, "WhatsApp en formato +52…"))
    .max(20)
    .default([]),
});
export type Channels = z.infer<typeof channelsSchema>;

export function parseChannels(raw: unknown): Channels {
  const parsed = channelsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { email: [], whatsapp: [] };
}

/** "a@x.mx, b@y.mx\nc@z.mx" → ["a@x.mx", "b@y.mx", "c@z.mx"] */
export function splitList(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export type Decision = {
  fingerprint: string;
  severity: Severity;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  mentionIds: string[];
};

const nf = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });
const windowLabel = (minutes: number) =>
  minutes % 60 === 0 ? `${minutes / 60} ${minutes === 60 ? "hora" : "horas"}` : `${minutes} min`;

export type VolumeStats = { current: number; mean: number; stddev: number };

/** Spike: current window above mean + k·σ of the baseline windows, and above a floor. */
export function decideSpike(stats: VolumeStats, c: Conditions["spike"]): Decision | null {
  // A flat baseline (σ = 0) would make any extra mention a spike; use σ ≥ 1.
  const threshold = stats.mean + c.k * Math.max(stats.stddev, 1);
  if (stats.current < c.min_mentions || stats.current <= threshold) return null;
  const ratio = stats.mean > 0 ? stats.current / stats.mean : null;
  const sigmas = (stats.current - stats.mean) / Math.max(stats.stddev, 1);
  return {
    fingerprint: "spike",
    severity: sigmas >= 2 * c.k ? "critical" : "high",
    title: `Pico de menciones: ${stats.current} en ${windowLabel(c.window_minutes)}`,
    summary:
      `Lo normal en ${c.baseline_days} días es ${nf.format(stats.mean)} por ventana (σ ${nf.format(stats.stddev)}). ` +
      (ratio ? `Ahora hay ${nf.format(ratio)} veces más.` : "Antes no había menciones en ventanas así."),
    payload: { ...stats, threshold, sigmas, window_minutes: c.window_minutes },
    mentionIds: [],
  };
}

export type SentimentStats = { currentClassified: number; currentNss: number; baselineClassified: number; baselineNss: number };

export function decideSentimentDrop(stats: SentimentStats, c: Conditions["sentiment_drop"]): Decision | null {
  if (stats.currentClassified < c.min_mentions || stats.baselineClassified === 0) return null;
  const drop = stats.baselineNss - stats.currentNss;
  if (drop < c.drop_points) return null;
  return {
    fingerprint: "sentiment",
    severity: drop >= 2 * c.drop_points ? "critical" : "high",
    title: `El sentimiento cayó ${nf.format(drop)} puntos`,
    summary: `NSS de ${nf.format(stats.currentNss)} en las últimas ${windowLabel(c.window_minutes)} (${stats.currentClassified} menciones) contra ${nf.format(stats.baselineNss)} en los ${c.baseline_days} días previos.`,
    payload: { ...stats, drop, window_minutes: c.window_minutes },
    mentionIds: [],
  };
}

export type Candidate = {
  mentionId: string;
  text: string;
  sentiment: string | null;
  authorId: string | null;
  authorKind: string | null;
  authorName: string | null;
  terms: string[];
  maxSeverity: Severity | null;
};

const excerpt = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** One decision per risk term found at or above the minimum severity. */
export function decideRiskTerms(candidates: Candidate[], c: Conditions["risk_term"]): Decision[] {
  const byTerm = new Map<string, Candidate[]>();
  for (const m of candidates) {
    if (!m.maxSeverity || SEVERITY_RANK[m.maxSeverity] < SEVERITY_RANK[c.min_severity]) continue;
    for (const term of m.terms) byTerm.set(term, [...(byTerm.get(term) ?? []), m]);
  }
  return [...byTerm].map(([term, mentions]) => ({
    fingerprint: `term:${term.toLowerCase()}`,
    severity: mentions.reduce<Severity>((s, m) => (SEVERITY_RANK[m.maxSeverity!] > SEVERITY_RANK[s] ? m.maxSeverity! : s), "low"),
    title: `Término de riesgo: «${term}» (${mentions.length} ${mentions.length === 1 ? "mención" : "menciones"})`,
    summary: excerpt(mentions[0].text),
    payload: { term, count: mentions.length },
    mentionIds: mentions.slice(0, 10).map((m) => m.mentionId),
  }));
}

/** One decision per media outlet / public figure with negative mentions. */
export function decideMediaNegative(candidates: Candidate[]): Decision[] {
  const byAuthor = new Map<string, Candidate[]>();
  for (const m of candidates) {
    if (m.sentiment !== "negative" || !m.authorId || !(m.authorKind === "media" || m.authorKind === "public_figure")) continue;
    byAuthor.set(m.authorId, [...(byAuthor.get(m.authorId) ?? []), m]);
  }
  return [...byAuthor].map(([authorId, mentions]) => {
    const who = mentions[0].authorName ?? "Un medio";
    const kind = mentions[0].authorKind === "media" ? "medio" : "figura pública";
    return {
      fingerprint: `author:${authorId}`,
      severity: mentions.length >= 3 ? "high" : "medium",
      title: `${who} (${kind}) publicó ${mentions.length === 1 ? "una mención negativa" : `${mentions.length} menciones negativas`}`,
      summary: excerpt(mentions[0].text),
      payload: { author_id: authorId, author: who, count: mentions.length },
      mentionIds: mentions.slice(0, 10).map((m) => m.mentionId),
    };
  });
}

export type DigestNumbers = {
  mentions: number;
  positive: number;
  neutral: number;
  negative: number;
  complaints: number;
  open_tickets: number;
  top_topics: { topic: string; mentions: number }[];
  top_neighborhoods: { name: string; complaints: number }[];
};

const mxDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" });
const mxHour = new Intl.DateTimeFormat("en-US", { timeZone: "America/Mexico_City", hour: "numeric", hourCycle: "h23" });

/** Digest fires once per Mexico City day, from the configured hour on. */
export function digestDue(c: Conditions["daily_digest"], now: Date): { due: boolean; day: string } {
  return { due: Number(mxHour.format(now)) >= c.hour, day: mxDay.format(now) };
}

export function decideDigest(day: string, n: DigestNumbers): Decision {
  const classified = n.positive + n.neutral + n.negative;
  const nss = classified ? ((n.positive - n.negative) / classified) * 100 : 0;
  const topics = n.top_topics.map((t) => `${t.topic} (${t.mentions})`).join(", ");
  const places = n.top_neighborhoods.map((p) => `${p.name} (${p.complaints})`).join(", ");
  return {
    fingerprint: `digest:${day}`,
    severity: "low",
    title: `Resumen del día: ${n.mentions} menciones, NSS ${nf.format(Math.round(nss))}`,
    summary: [
      `${n.negative} negativas, ${n.positive} positivas y ${n.complaints} quejas o denuncias en 24 h; ${n.open_tickets} tickets abiertos.`,
      topics && `Temas: ${topics}.`,
      places && `Colonias con más quejas: ${places}.`,
    ]
      .filter(Boolean)
      .join(" "),
    payload: { ...n, nss },
    mentionIds: [],
  };
}

/** Suggested starter rules for a new municipality. */
export function defaultRules(): { name: string; kind: RuleKind; condition: Record<string, unknown>; cooldown: number }[] {
  return RULE_KINDS.map((kind) => ({
    name: RULE_KIND_LABELS[kind],
    kind,
    condition: CONDITION_SCHEMAS[kind].parse({}) as Record<string, unknown>,
    cooldown: DEFAULT_COOLDOWN[kind],
  }));
}

/** One line in plain Spanish: what the rule watches with its current parameters. */
export function describeRule(kind: RuleKind, raw: unknown): string {
  switch (kind) {
    case "spike": {
      const c = parseCondition("spike", raw);
      return c
        ? `Más de media + ${nf.format(c.k)}σ en ${windowLabel(c.window_minutes)} (base ${c.baseline_days} días, mínimo ${c.min_mentions}).`
        : "Parámetros inválidos.";
    }
    case "sentiment_drop": {
      const c = parseCondition("sentiment_drop", raw);
      return c
        ? `NSS ${nf.format(c.drop_points)} puntos abajo en ${windowLabel(c.window_minutes)} vs. ${c.baseline_days} días (mínimo ${c.min_mentions}).`
        : "Parámetros inválidos.";
    }
    case "risk_term": {
      const c = parseCondition("risk_term", raw);
      return c ? `Términos de severidad ${SEVERITY_LABELS[c.min_severity].toLowerCase()} o más, revisados cada ${windowLabel(c.window_minutes)}.` : "Parámetros inválidos.";
    }
    case "media_negative": {
      const c = parseCondition("media_negative", raw);
      return c ? `Menciones negativas de medios y figuras públicas en ${windowLabel(c.window_minutes)}.` : "Parámetros inválidos.";
    }
    case "daily_digest": {
      const c = parseCondition("daily_digest", raw);
      return c ? `Todos los días a las ${c.hour}:00 (hora de la Ciudad de México).` : "Parámetros inválidos.";
    }
  }
}

/** Where an alert's "Ver menciones" goes: the inbox narrowed to what fired it. */
export function alertHref(alert: { kind: RuleKind | null; mentionIds: string[]; payload: Record<string, unknown>; createdAt: string }): string {
  const day = mxDay.format(new Date(alert.createdAt));
  const base = new URLSearchParams({ from: day, to: day, status: "all" });
  if (alert.kind === "daily_digest") return "/dashboard?periodo=24h";
  if (alert.kind === "media_negative" && typeof alert.payload.author_id === "string") base.set("author", alert.payload.author_id);
  else if (alert.mentionIds.length === 1) base.set("mention", alert.mentionIds[0]);
  else if (alert.kind === "risk_term" && typeof alert.payload.term === "string") base.set("q", alert.payload.term);
  else if (alert.kind === "sentiment_drop") base.set("sentiment", "negative");
  return `/bandeja?${base}`;
}
