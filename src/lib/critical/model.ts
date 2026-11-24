// Voces críticas: shapes and derived figures of the negative conversation.
// Pure (shared by the server page, the client and unit tests). Nothing here
// carries an author: the panel reads what is said, not who says it.
import { normalizeText } from "../query/normalize.ts";

export type CriticalTotals = { negative: number; classified: number; prevNegative: number; prevClassified: number };
export type CriticalPoint = { bucket: string; negative: number; classified: number };
export type CriticalTopic = { topic: string; negative: number; prevNegative: number; classified: number; rising: boolean };
export type CriticalPlace = { id: string; name: string; negative: number; prevNegative: number; rising: boolean };
export type CriticalCount = { key: string; negative: number };
export type CriticalMention = {
  id: string;
  text: string;
  url: string | null;
  publishedAt: string;
  topic: string | null;
  sourceType: string;
  neighborhood: string | null;
  interactions: number;
};
export type Term = { term: string; count: number };

export type CriticalVoices = {
  totals: CriticalTotals;
  series: CriticalPoint[];
  topics: CriticalTopic[];
  neighborhoods: CriticalPlace[];
  departments: CriticalPlace[];
  platforms: CriticalCount[];
  emotions: CriticalCount[];
  top: CriticalMention[];
  terms: Term[];
};

/** A topic or place "is growing" with at least this many negative mentions now… */
export const RISING_MIN = 5;
/** …and at least this relative growth over the previous period (or none before). */
export const RISING_GROWTH = 0.5;

export function isRising(now: number, before: number): boolean {
  if (now < RISING_MIN) return false;
  return before === 0 || (now - before) / before >= RISING_GROWTH;
}

/** Relative change, or null when there is nothing to compare with. */
export function change(now: number, before: number): number | null {
  return before > 0 ? (now - before) / before : null;
}

export function share(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : 0);
const s = (v: unknown) => (typeof v === "string" ? v : null);
const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

// ---------------------------------------------------------------------------
// Frequent terms
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(
  (
    "a al algo algun alguna algunas alguno algunos ante antes aqui asi aun aunque bien cada como con contra cual cuales cuando de del " +
    "desde donde dos el ella ellas ello ellos en entre era eran es esa esas ese eso esos esta estaba estado estan estar estas este esto " +
    "estos fue fueron ha habia han hasta hay hace hacen hacer la las le les lo los mas me mi mis mucho muy nada ni no nos nosotros o otra " +
    "otro otros para pero poco por porque pues que quien se sea ser si sin sobre solo son su sus tambien tan tanto te tiene tienen todo " +
    "todos tu tus un una uno unos usted ustedes va van ver vez y ya yo q xq pq k rt via hoy ayer manana dia dias ahora gracias favor " +
    "les nomas siempre nunca todavia cosa cosas gente año años mismo misma sigue siguen dicen dice puede pueden quieren tienen " +
    "fui fuimos dijeron dijo estoy estamos tengo tenemos hicieron hizo lunes martes miércoles jueves viernes sábado domingo semana"
  )
    .split(/\s+/)
    .map(normalizeText),
);

type Token = { key: string; word: string };

/** Words of a text without links, emails or @handles (never surfaced): normalized key and as written. */
function tokens(text: string): Token[] {
  const cleaned = text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\S+@\S+\.\S+/g, " ")
    .replace(/(^|[^\p{L}\p{N}_])@[\p{L}\p{N}_.]+/gu, " ")
    .replace(/#/g, " ");
  return cleaned
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => ({ key: normalizeText(w), word: w.toLowerCase() }));
}

const keep = (w: string, exclude: ReadonlySet<string>) => w.length >= 3 && !/^\d+$/.test(w) && !STOPWORDS.has(w) && !exclude.has(w);

/** Words of a text without links, @handles, numbers, stopwords or excluded words (normalized). */
export function termWords(text: string, exclude: ReadonlySet<string> = new Set()): string[] {
  return tokens(text).map((t) => t.key).filter((w) => keep(w, exclude));
}

/** Connectors a phrase may keep in the middle: "fuga de agua". */
const LINKS = new Set(["de", "del"]);

/** Two-word phrases of adjacent words (or joined by "de"), as [normalized key, as written]. */
function phrases(text: string, exclude: ReadonlySet<string>): [string, string][] {
  const ts = tokens(text);
  const out: [string, string][] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    if (!keep(ts[i].key, exclude)) continue;
    const next = ts[i + 1];
    if (keep(next.key, exclude) && next.key !== ts[i].key) out.push([`${ts[i].key} ${next.key}`, `${ts[i].word} ${next.word}`]);
    else if (LINKS.has(next.key) && i + 2 < ts.length && keep(ts[i + 2].key, exclude)) {
      out.push([`${ts[i].key} ${next.key} ${ts[i + 2].key}`, `${ts[i].word} ${next.word} ${ts[i + 2].word}`]);
    }
  }
  return out;
}

/** Most frequent way of writing each term ("señora" over "senora"). */
function spellings() {
  const seen = new Map<string, Map<string, number>>();
  return {
    add(key: string, word: string) {
      const forms = seen.get(key) ?? new Map<string, number>();
      forms.set(word, (forms.get(word) ?? 0) + 1);
      seen.set(key, forms);
    },
    best(key: string): string {
      const forms = seen.get(key);
      if (!forms) return key;
      // Most used; on a tie, the accented one.
      return [...forms].sort((a, b) => b[1] - a[1] || (b[0] !== normalizeText(b[0]) ? 1 : 0) - (a[0] !== normalizeText(a[0]) ? 1 : 0))[0][0];
    },
  };
}

/**
 * Most repeated words and short phrases of the negative texts. A phrase is
 * kept when it repeats at least twice; its words then only count beyond it.
 */
export function topTerms(texts: readonly string[], exclude: ReadonlySet<string> = new Set(), limit = 20): Term[] {
  const words = new Map<string, number>();
  const pairs = new Map<string, number>();
  const written = spellings();
  for (const text of texts) {
    // Each text counts once per term: one long rant does not dominate.
    const ws = tokens(text).filter((t) => keep(t.key, exclude));
    for (const t of ws) written.add(t.key, t.word);
    for (const w of new Set(ws.map((t) => t.key))) words.set(w, (words.get(w) ?? 0) + 1);
    const ps = phrases(text, exclude);
    for (const [key, word] of ps) written.add(key, word);
    for (const p of new Set(ps.map(([key]) => key))) pairs.set(p, (pairs.get(p) ?? 0) + 1);
  }
  const keyed = [...pairs].filter(([, c]) => c >= 2).map(([key, count]) => ({ key, count }));
  for (const t of keyed) for (const w of t.key.split(" ")) if (words.has(w)) words.set(w, words.get(w)! - t.count);
  for (const [key, count] of words) if (count >= 2) keyed.push({ key, count });
  return keyed
    .map(({ key, count }) => ({ term: written.best(key), count }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term, "es"))
    .slice(0, limit);
}

/** Words of the municipality's own name: they appear everywhere and say nothing. */
export function nameWords(...names: (string | null | undefined)[]): Set<string> {
  return new Set(names.flatMap((name) => (name ? normalizeText(name).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3) : [])));
}

// ---------------------------------------------------------------------------
// Parsing the RPC answer
// ---------------------------------------------------------------------------

export function parseCriticalVoices(raw: Record<string, unknown>, exclude: ReadonlySet<string> = new Set()): CriticalVoices {
  const t = (raw.totals ?? {}) as Record<string, unknown>;
  const place = (r: Record<string, unknown>): CriticalPlace => ({
    id: String(r.id),
    name: s(r.name) ?? "",
    negative: n(r.negative),
    prevNegative: n(r.prev_negative),
    rising: isRising(n(r.negative), n(r.prev_negative)),
  });
  return {
    totals: { negative: n(t.negative), classified: n(t.classified), prevNegative: n(t.prev_negative), prevClassified: n(t.prev_classified) },
    series: rows(raw.series).map((r) => ({ bucket: String(r.bucket), negative: n(r.negative), classified: n(r.classified) })),
    topics: rows(raw.topics).map((r) => ({
      topic: s(r.topic) ?? "",
      negative: n(r.negative),
      prevNegative: n(r.prev_negative),
      classified: n(r.classified),
      rising: isRising(n(r.negative), n(r.prev_negative)),
    })),
    neighborhoods: rows(raw.neighborhoods).map(place),
    departments: rows(raw.departments).map(place),
    platforms: rows(raw.platforms).map((r) => ({ key: s(r.type) ?? "", negative: n(r.negative) })),
    emotions: rows(raw.emotions).map((r) => ({ key: s(r.emotion) ?? "", negative: n(r.negative) })),
    top: rows(raw.top).map((r) => ({
      id: String(r.id),
      text: s(r.text) ?? "",
      url: s(r.url),
      publishedAt: String(r.published_at),
      topic: s(r.topic),
      sourceType: s(r.source_type) ?? "",
      neighborhood: s(r.neighborhood),
      interactions: n(r.interactions),
    })),
    terms: topTerms(Array.isArray(raw.texts) ? raw.texts.filter((x): x is string => typeof x === "string") : [], exclude),
  };
}
