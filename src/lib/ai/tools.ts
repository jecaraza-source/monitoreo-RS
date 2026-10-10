// Read-only tools for the assistant (/asistente). Each one queries Supabase
// with the signed-in user's client, so RLS decides what it can see: a
// dependencia user only gets what was routed to their department. There is
// no free-form SQL: every tool is a fixed, parameterized query whose input is
// validated with zod before it runs.

import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { filtersToSearch, type InboxFilters } from "../inbox/model.ts";
import { dayEnd, dayStart } from "../inbox/model.ts";
import type { Database } from "../supabase/database.types.ts";

type Client = SupabaseClient<Database>;
type Sentiment = Database["public"]["Enums"]["sentiment"];

export type ToolContext = {
  client: Client;
  orgId: string;
  /** Today in Mexico City (YYYY-MM-DD). */
  today: string;
  departments: { id: string; name: string }[];
  neighborhoods: { id: string; name: string }[];
};

export type ChartPoint = { label: string; value: number; negative?: number; positive?: number; neutral?: number };
export type ToolChart =
  | { kind: "bars"; title: string; unit: string; data: ChartPoint[] }
  | { kind: "series"; title: string; data: ChartPoint[] };
export type ToolLink = { label: string; href: string };
export type ToolOutput = { result: unknown; chart?: ToolChart; links?: ToolLink[] };

export const MAX_ROWS = 5000;
export const MAX_RANGE_DAYS = 92;
const DAY = 86_400_000;

const SENTIMENT_ES: Record<Sentiment, string> = { positive: "positivo", neutral: "neutral", negative: "negativo" };
const SENTIMENT_DB: Record<string, Sentiment> = { positivo: "positive", neutral: "neutral", negativo: "negative" };

// ---------------------------------------------------------------------------
// Tool definitions (JSON schema for Claude) and input validation (zod)
// ---------------------------------------------------------------------------

const range = {
  desde: { type: "string", description: "Primer día (YYYY-MM-DD, hora de la Ciudad de México). Por omisión, hace 7 días." },
  hasta: { type: "string", description: "Último día (YYYY-MM-DD). Por omisión, hoy." },
} as const;
const filters = {
  tema: { type: "string", description: "Tema exacto de la taxonomía (por ejemplo, agua potable)." },
  sentimiento: { type: "string", enum: ["positivo", "neutral", "negativo"] },
  dependencia: { type: "string", description: "Nombre exacto de una dependencia del catálogo." },
  colonia: { type: "string", description: "Nombre exacto de una colonia del catálogo." },
} as const;

export const ASSISTANT_TOOLS: Anthropic.Beta.Messages.BetaTool[] = [
  {
    name: "get_kpis",
    description:
      "Indicadores de un periodo y su comparación con el periodo anterior de igual duración: menciones, % por sentimiento, NSS, quejas, turnos abiertos y resueltos, tiempo promedio de atención y la serie diaria.",
    input_schema: { type: "object", additionalProperties: false, properties: { ...range, ...filters } },
  },
  {
    name: "top_topics",
    description: "Temas con más menciones en el periodo, con su porcentaje negativo y NSS.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { ...range, ...filters, limite: { type: "integer", description: "Máximo de temas (1 a 15, por omisión 8)." } },
    },
  },
  {
    name: "search_mentions",
    description:
      "Busca menciones por texto y filtros y devuelve hasta 10 ejemplos (texto, fecha, origen, sentimiento, tema). Úsala para citar ejemplos concretos, no para contar.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        texto: { type: "string", description: "Palabras a buscar (opcional)." },
        ...range,
        ...filters,
        limite: { type: "integer", description: "1 a 10, por omisión 5." },
      },
    },
  },
  {
    name: "stats_by_neighborhood",
    description: "Menciones, quejas y negativas por colonia en el periodo (ordenadas por quejas), con filtros opcionales.",
    input_schema: { type: "object", additionalProperties: false, properties: { ...range, ...filters } },
  },
  {
    name: "stats_by_department",
    description: "Por dependencia: menciones, NSS, turnos abiertos, resueltos, vencidos y horas promedio de atención en el periodo.",
    input_schema: { type: "object", additionalProperties: false, properties: { ...range, ...filters } },
  },
].map((tool) => ({ ...tool, eager_input_streaming: true }) as Anthropic.Beta.Messages.BetaTool);

export const TOOL_LABELS: Record<string, string> = {
  get_kpis: "Consultando indicadores",
  top_topics: "Revisando temas",
  search_mentions: "Buscando menciones",
  stats_by_neighborhood: "Agrupando por colonia",
  stats_by_department: "Agrupando por dependencia",
};

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato YYYY-MM-DD.");
const baseInput = z.object({
  desde: day.optional(),
  hasta: day.optional(),
  tema: z.string().trim().min(1).max(80).optional(),
  sentimiento: z.enum(["positivo", "neutral", "negativo"]).optional(),
  dependencia: z.string().trim().min(1).max(120).optional(),
  colonia: z.string().trim().min(1).max(120).optional(),
});

export const TOOL_INPUTS = {
  get_kpis: baseInput,
  top_topics: baseInput.extend({ limite: z.number().int().min(1).max(15).optional() }),
  search_mentions: baseInput.extend({ texto: z.string().trim().max(200).optional(), limite: z.number().int().min(1).max(10).optional() }),
  stats_by_neighborhood: baseInput,
  stats_by_department: baseInput,
} as const;

export type ToolName = keyof typeof TOOL_INPUTS;
export const isToolName = (name: string): name is ToolName => name in TOOL_INPUTS;

// ---------------------------------------------------------------------------
// Shared resolution: period, catalog names → ids, inbox links
// ---------------------------------------------------------------------------

export class ToolInputError extends Error {}

function addDays(dayStr: string, n: number): string {
  const d = new Date(`${dayStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type Resolved = {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  sentiment?: Sentiment;
  topic?: string;
  department?: { id: string; name: string };
  neighborhood?: { id: string; name: string };
};

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

export function resolveInput(input: z.infer<typeof baseInput>, ctx: Pick<ToolContext, "today" | "departments" | "neighborhoods">): Resolved {
  const to = input.hasta ?? ctx.today;
  const from = input.desde ?? addDays(to, -6);
  if (from > to) throw new ToolInputError("'desde' es posterior a 'hasta'.");
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
  if (days > MAX_RANGE_DAYS) throw new ToolInputError(`El periodo máximo es de ${MAX_RANGE_DAYS} días.`);
  const find = (list: { id: string; name: string }[], name: string | undefined, what: string) => {
    if (!name) return undefined;
    const hit = list.find((x) => normalize(x.name) === normalize(name));
    if (!hit) throw new ToolInputError(`No existe la ${what} «${name}». Opciones: ${list.map((x) => x.name).join(", ") || "ninguna"}.`);
    return hit;
  };
  return {
    from,
    to,
    prevTo: addDays(from, -1),
    prevFrom: addDays(from, -days),
    sentiment: input.sentimiento ? SENTIMENT_DB[input.sentimiento] : undefined,
    topic: input.tema,
    department: find(ctx.departments, input.dependencia, "dependencia"),
    neighborhood: find(ctx.neighborhoods, input.colonia, "colonia"),
  };
}

/** Link to the inbox narrowed to the same period and filters. */
export function inboxLink(r: Resolved, extra: InboxFilters = {}): string {
  return `/bandeja${filtersToSearch({
    from: r.from,
    to: r.to,
    status: "all",
    ...(r.sentiment ? { sentiment: r.sentiment } : {}),
    ...(r.topic ? { topic: r.topic } : {}),
    ...(r.department ? { department: r.department.id } : {}),
    ...(r.neighborhood ? { neighborhood: r.neighborhood.id } : {}),
    ...extra,
  })}`;
}

// ---------------------------------------------------------------------------
// Data access (user's session → RLS) and pure aggregation
// ---------------------------------------------------------------------------

export type Row = {
  id: string;
  publishedAt: string;
  text: string;
  platform: string | null;
  author: string | null;
  sentiment: Sentiment | null;
  topic: string | null;
  intent: string | null;
  departmentId: string | null;
  neighborhoodId: string | null;
  interactions: number;
};

type RawMention = {
  id: string;
  published_at: string;
  text: string;
  metrics: Record<string, number> | null;
  author: { display_name: string | null; handle: string; kind: string } | null;
  source: { type: string } | null;
  c:
    | { sentiment: Sentiment | null; topic: string | null; intent: string | null; department_id: string | null; neighborhood_id: string | null }
    | { sentiment: Sentiment | null; topic: string | null; intent: string | null; department_id: string | null; neighborhood_id: string | null }[]
    | null;
};

const SELECT =
  "id, published_at, text, metrics, author:authors(display_name, handle, kind), source:sources(type), c:classifications(sentiment, topic, intent, department_id, neighborhood_id)";

function toRow(m: RawMention): Row {
  const c = Array.isArray(m.c) ? (m.c[0] ?? null) : m.c;
  const metrics = m.metrics ?? {};
  const named = m.author && (m.author.kind === "media" || m.author.kind === "public_figure");
  return {
    id: m.id,
    publishedAt: m.published_at,
    text: m.text,
    platform: m.source?.type ?? null,
    // Citizens are never identified (see CLAUDE.md).
    author: named ? (m.author!.display_name ?? m.author!.handle) : null,
    sentiment: c?.sentiment ?? null,
    topic: c?.topic ?? null,
    intent: c?.intent ?? null,
    departmentId: c?.department_id ?? null,
    neighborhoodId: c?.neighborhood_id ?? null,
    interactions: (metrics.likes ?? 0) + (metrics.shares ?? 0) + (metrics.comments ?? 0),
  };
}

export function applyFilters(rows: Row[], r: Resolved): Row[] {
  return rows.filter(
    (row) =>
      (!r.sentiment || row.sentiment === r.sentiment) &&
      (!r.topic || normalize(row.topic ?? "") === normalize(r.topic)) &&
      (!r.department || row.departmentId === r.department.id) &&
      (!r.neighborhood || row.neighborhoodId === r.neighborhood.id),
  );
}

async function loadRows(ctx: ToolContext, fromDay: string, toDay: string, text?: string): Promise<{ rows: Row[]; truncated: boolean }> {
  let query = ctx.client
    .from("mentions")
    .select(SELECT)
    .eq("org_id", ctx.orgId)
    .gte("published_at", dayStart(fromDay))
    .lt("published_at", dayEnd(toDay))
    .order("published_at", { ascending: false })
    .limit(MAX_ROWS);
  if (text) query = query.textSearch("search", text, { config: "spanish_unaccent", type: "websearch" });
  const { data, error } = await query;
  if (error) throw new Error(`No se pudieron leer las menciones: ${error.message}`);
  const rows = (data as unknown as RawMention[]).map(toRow);
  return { rows, truncated: rows.length >= MAX_ROWS };
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const pct = (part: number, total: number) => (total > 0 ? r1((part / total) * 100) : 0);
export const nssOf = (rows: Row[]) => {
  const classified = rows.filter((r) => r.sentiment).length;
  const pos = rows.filter((r) => r.sentiment === "positive").length;
  const neg = rows.filter((r) => r.sentiment === "negative").length;
  return classified ? r1(((pos - neg) / classified) * 100) : 0;
};
const isComplaint = (r: Row) => r.intent === "queja" || r.intent === "denuncia";

export function summarize(rows: Row[]) {
  const classified = rows.filter((r) => r.sentiment).length;
  const count = (s: Sentiment) => rows.filter((r) => r.sentiment === s).length;
  return {
    menciones: rows.length,
    clasificadas: classified,
    positivas_pct: pct(count("positive"), classified),
    neutrales_pct: pct(count("neutral"), classified),
    negativas_pct: pct(count("negative"), classified),
    nss: nssOf(rows),
    quejas: rows.filter(isComplaint).length,
    interacciones: rows.reduce((s, r) => s + r.interactions, 0),
  };
}

const mxDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" });
const shortDay = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });

export function dailySeries(rows: Row[], from: string, to: string): ChartPoint[] {
  const byDay = new Map<string, ChartPoint>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    byDay.set(d, { label: shortDay.format(new Date(`${d}T12:00:00Z`)), value: 0, positive: 0, neutral: 0, negative: 0 });
  }
  for (const row of rows) {
    const point = byDay.get(mxDay.format(new Date(row.publishedAt)));
    if (!point) continue;
    point.value++;
    if (row.sentiment) point[row.sentiment] = (point[row.sentiment] ?? 0) + 1;
  }
  return [...byDay.values()];
}

export function groupBy<K extends string>(rows: Row[], key: (r: Row) => K | null) {
  const groups = new Map<K, Row[]>();
  for (const row of rows) {
    const k = key(row);
    if (k == null) continue;
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  return groups;
}

const PLATFORM_ES: Record<string, string> = { meta: "Facebook", rss: "Medio (RSS)", youtube: "YouTube", x: "X" };
const fullDate = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" });

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

function periodOf(r: Resolved) {
  return { desde: r.from, hasta: r.to, comparado_con: `${r.prevFrom} a ${r.prevTo}` };
}

function appliedFilters(r: Resolved) {
  return {
    ...(r.topic ? { tema: r.topic } : {}),
    ...(r.sentiment ? { sentimiento: SENTIMENT_ES[r.sentiment] } : {}),
    ...(r.department ? { dependencia: r.department.name } : {}),
    ...(r.neighborhood ? { colonia: r.neighborhood.name } : {}),
  };
}

async function getKpis(ctx: ToolContext, r: Resolved): Promise<ToolOutput> {
  const [current, previous, tickets] = await Promise.all([
    loadRows(ctx, r.from, r.to),
    loadRows(ctx, r.prevFrom, r.prevTo),
    ctx.client
      .from("tickets")
      .select("status, created_at, resolved_at, due_at, department_id")
      .eq("org_id", ctx.orgId)
      .gte("created_at", dayStart(r.from))
      .lt("created_at", dayEnd(r.to))
      .limit(MAX_ROWS),
  ]);
  const rows = applyFilters(current.rows, r);
  const prev = applyFilters(previous.rows, r);
  const now = summarize(rows);
  const before = summarize(prev);
  const t = (tickets.data ?? []).filter((x) => !r.department || x.department_id === r.department.id);
  const resolved = t.filter((x) => x.resolved_at);
  const hours = resolved.length
    ? r1(resolved.reduce((s, x) => s + (Date.parse(x.resolved_at!) - Date.parse(x.created_at)) / 3_600_000, 0) / resolved.length)
    : null;
  const series = dailySeries(rows, r.from, r.to);
  return {
    result: {
      periodo: periodOf(r),
      filtros: appliedFilters(r),
      actual: now,
      anterior: before,
      variacion_menciones_pct: before.menciones ? r1(((now.menciones - before.menciones) / before.menciones) * 100) : null,
      variacion_nss_puntos: r1(now.nss - before.nss),
      turnos: {
        turnados: t.length,
        abiertos: t.filter((x) => x.status === "open" || x.status === "in_progress").length,
        resueltos: resolved.length,
        vencidos: t.filter((x) => !x.resolved_at && x.due_at && Date.parse(x.due_at) < Date.now()).length,
        horas_promedio_atencion: hours,
      },
      serie_diaria: series.map((p) => ({ dia: p.label, menciones: p.value, negativas: p.negative })),
      datos_parciales: current.truncated,
    },
    chart: { kind: "series", title: "Menciones por día", data: series },
    links: [{ label: "Ver estas menciones en la bandeja", href: inboxLink(r) }],
  };
}

async function topTopics(ctx: ToolContext, r: Resolved, limit = 8): Promise<ToolOutput> {
  const { rows, truncated } = await loadRows(ctx, r.from, r.to);
  const filtered = applyFilters(rows, r);
  const groups = [...groupBy(filtered, (x) => x.topic)].map(([topic, list]) => ({
    tema: topic,
    menciones: list.length,
    negativas_pct: pct(list.filter((x) => x.sentiment === "negative").length, list.length),
    nss: nssOf(list),
  }));
  const top = groups.sort((a, b) => b.menciones - a.menciones).slice(0, limit);
  return {
    result: { periodo: periodOf(r), filtros: appliedFilters(r), total_menciones: filtered.length, temas: top, datos_parciales: truncated },
    chart: { kind: "bars", title: "Temas con más menciones", unit: "menciones", data: top.map((t) => ({ label: t.tema, value: t.menciones })) },
    links: top.slice(0, 3).map((t) => ({ label: `Bandeja: ${t.tema}`, href: inboxLink({ ...r, topic: t.tema }) })),
  };
}

async function searchMentions(ctx: ToolContext, r: Resolved, text?: string, limit = 5): Promise<ToolOutput> {
  const { rows } = await loadRows(ctx, r.from, r.to, text || undefined);
  const hits = applyFilters(rows, r)
    .sort((a, b) => b.interactions - a.interactions || b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, limit);
  const names = new Map(ctx.departments.map((d) => [d.id, d.name]));
  const hoods = new Map(ctx.neighborhoods.map((n) => [n.id, n.name]));
  return {
    result: {
      periodo: periodOf(r),
      filtros: { ...appliedFilters(r), ...(text ? { texto: text } : {}) },
      encontradas: hits.length,
      menciones: hits.map((m) => ({
        fecha: fullDate.format(new Date(m.publishedAt)),
        origen: `${PLATFORM_ES[m.platform ?? ""] ?? "Red social"} · ${m.author ?? "ciudadano"}`,
        sentimiento: m.sentiment ? SENTIMENT_ES[m.sentiment] : "sin clasificar",
        tema: m.topic,
        dependencia: m.departmentId ? names.get(m.departmentId) : null,
        colonia: m.neighborhoodId ? hoods.get(m.neighborhoodId) : null,
        interacciones: m.interactions,
        texto: m.text.slice(0, 300),
      })),
    },
    links: [{ label: "Abrir la búsqueda en la bandeja", href: inboxLink(r, text ? { q: text } : {}) }],
  };
}

async function statsByNeighborhood(ctx: ToolContext, r: Resolved): Promise<ToolOutput> {
  const { rows, truncated } = await loadRows(ctx, r.from, r.to);
  const filtered = applyFilters(rows, r);
  const names = new Map(ctx.neighborhoods.map((n) => [n.id, n.name]));
  const stats = [...groupBy(filtered, (x) => x.neighborhoodId)]
    .map(([id, list]) => ({
      id,
      colonia: names.get(id) ?? "Sin nombre",
      menciones: list.length,
      quejas: list.filter(isComplaint).length,
      negativas: list.filter((x) => x.sentiment === "negative").length,
    }))
    .sort((a, b) => b.quejas - a.quejas || b.menciones - a.menciones)
    .slice(0, 15);
  return {
    result: {
      periodo: periodOf(r),
      filtros: appliedFilters(r),
      sin_colonia: filtered.filter((x) => !x.neighborhoodId).length,
      colonias: stats.map((s) => ({ colonia: s.colonia, menciones: s.menciones, quejas: s.quejas, negativas: s.negativas })),
      datos_parciales: truncated,
    },
    chart: { kind: "bars", title: "Quejas por colonia", unit: "quejas", data: stats.filter((s) => s.quejas > 0).slice(0, 10).map((s) => ({ label: s.colonia, value: s.quejas })) },
    links: stats.slice(0, 3).map((s) => ({ label: `Bandeja: ${s.colonia}`, href: inboxLink({ ...r, neighborhood: { id: s.id, name: s.colonia } }) })),
  };
}

async function statsByDepartment(ctx: ToolContext, r: Resolved): Promise<ToolOutput> {
  const [{ rows, truncated }, tickets] = await Promise.all([
    loadRows(ctx, r.from, r.to),
    ctx.client
      .from("tickets")
      .select("status, created_at, resolved_at, due_at, department_id")
      .eq("org_id", ctx.orgId)
      .gte("created_at", dayStart(r.from))
      .lt("created_at", dayEnd(r.to))
      .limit(MAX_ROWS),
  ]);
  const filtered = applyFilters(rows, r);
  const ticketsBy = new Map<string, NonNullable<typeof tickets.data>>();
  for (const t of tickets.data ?? []) ticketsBy.set(t.department_id, [...(ticketsBy.get(t.department_id) ?? []), t]);
  const mentionsBy = groupBy(filtered, (x) => x.departmentId);
  const ids = new Set([...mentionsBy.keys(), ...ticketsBy.keys()]);
  const names = new Map(ctx.departments.map((d) => [d.id, d.name]));
  const stats = [...ids]
    .filter((id) => !r.department || id === r.department.id)
    .map((id) => {
      const list = mentionsBy.get(id) ?? [];
      const t = ticketsBy.get(id) ?? [];
      const resolved = t.filter((x) => x.resolved_at);
      return {
        id,
        dependencia: names.get(id) ?? "Sin nombre",
        menciones: list.length,
        nss: nssOf(list),
        turnos: t.length,
        abiertos: t.filter((x) => x.status === "open" || x.status === "in_progress").length,
        resueltos: resolved.length,
        vencidos: t.filter((x) => !x.resolved_at && x.due_at && Date.parse(x.due_at) < Date.now()).length,
        horas_promedio_atencion: resolved.length
          ? r1(resolved.reduce((s, x) => s + (Date.parse(x.resolved_at!) - Date.parse(x.created_at)) / 3_600_000, 0) / resolved.length)
          : null,
      };
    })
    .sort((a, b) => a.nss - b.nss);
  return {
    result: { periodo: periodOf(r), filtros: appliedFilters(r), dependencias: stats.map((s) => {
        const { id, ...rest } = s;
        void id;
        return rest;
      }), datos_parciales: truncated },
    chart: { kind: "bars", title: "Sentimiento neto (NSS) por dependencia", unit: "NSS", data: stats.map((s) => ({ label: s.dependencia, value: s.nss })) },
    links: stats.slice(0, 3).map((s) => ({ label: `Bandeja: ${s.dependencia}`, href: inboxLink({ ...r, department: { id: s.id, name: s.dependencia } }) })),
  };
}

/** Validates the tool input and runs it; input errors come back as a readable message for Claude. */
export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolOutput & { error?: string }> {
  if (!isToolName(name)) return { result: null, error: `Herramienta desconocida: ${name}.` };
  const parsed = TOOL_INPUTS[name].safeParse(rawInput ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { result: null, error: `Parámetro inválido ${issue.path.join(".")}: ${issue.message}` };
  }
  try {
    const input = parsed.data as z.infer<typeof baseInput> & { limite?: number; texto?: string };
    const r = resolveInput(input, ctx);
    switch (name) {
      case "get_kpis":
        return await getKpis(ctx, r);
      case "top_topics":
        return await topTopics(ctx, r, input.limite);
      case "search_mentions":
        return await searchMentions(ctx, r, input.texto, input.limite);
      case "stats_by_neighborhood":
        return await statsByNeighborhood(ctx, r);
      case "stats_by_department":
        return await statsByDepartment(ctx, r);
    }
  } catch (error) {
    if (error instanceof ToolInputError) return { result: null, error: error.message };
    throw error;
  }
}
