// Inbox (/bandeja) model shared by the server page, the client list and the
// Server Actions. Pure module: no React, no Next, no Supabase client.
import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";

type Enums = Database["public"]["Enums"];
export type Sentiment = Enums["sentiment"];
export type Priority = Enums["priority"];
export type TicketStatus = Enums["ticket_status"];
export type TriageStatus = Enums["triage_status"];
export type SourceType = Enums["source_type"];
export type Severity = Enums["severity"];

/** Editors (admin, comunicacion) triage every mention; dependencia works its tickets. */
export type InboxScope = "editor" | "department";

export const PAGE_SIZE = 50;

export const SENTIMENT_LABELS: Record<Sentiment, string> = { positive: "Positivo", neutral: "Neutral", negative: "Negativo" };
export const PRIORITY_LABELS: Record<Priority, string> = { critical: "Crítica", high: "Alta", medium: "Media", low: "Baja" };
export const TRIAGE_LABELS: Record<TriageStatus, string> = {
  new: "Nueva",
  reviewed: "Revisada",
  routed: "Turnada",
  discarded: "Descartada",
};
export const TICKET_LABELS: Record<TicketStatus, string> = {
  open: "Abierto",
  in_progress: "En atención",
  resolved: "Resuelto",
  closed: "Cerrado",
};
export const INTENT_LABELS: Record<string, string> = {
  queja: "Queja",
  pregunta: "Pregunta",
  elogio: "Elogio",
  denuncia: "Denuncia",
  rumor: "Rumor",
  otro: "Otro",
};
/** Gravedad del hecho (no del tono): una crítica negativa puede tener gravedad "ninguna". */
export const SEVERITY_LABELS: Record<Severity, string> = {
  none: "Sin incidente",
  low: "Baja",
  moderate: "Media",
  high: "Alta",
  emergency: "Emergencia",
};
export const SEVERITIES = Object.keys(SEVERITY_LABELS) as Severity[];
export const INCIDENT_LABELS: Record<string, string> = {
  none: "Ninguno",
  public_service: "Servicio público",
  infrastructure: "Infraestructura",
  public_safety: "Seguridad pública",
  violence: "Violencia",
  health: "Salud",
  civil_protection: "Protección civil",
  environment: "Medio ambiente",
  corruption: "Corrupción",
  other: "Otro",
};
export const INCIDENT_TYPES = Object.keys(INCIDENT_LABELS);

// ---------------------------------------------------------------------------
// Operational views (public.inbox_queue / inbox_counts: same predicate for
// list and counter)
// ---------------------------------------------------------------------------
export const INBOX_VIEWS = ["new", "urgent", "unassigned", "acceptance", "overdue", "validation"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];
export const VIEW_LABELS: Record<InboxView, { label: string; hint: string }> = {
  new: { label: "Nuevas", hint: "Menciones sin revisar y casos recién abiertos." },
  urgent: { label: "Urgentes", hint: "Prioridad crítica o alta, o gravedad alta o de emergencia, aún sin resolver." },
  unassigned: { label: "Sin responsable", hint: "Requieren atención y nadie las tiene: sin turnar o casos sin dependencia." },
  acceptance: { label: "Por aceptar", hint: "Turnos y casos asignados que la dependencia aún no acepta ni inicia." },
  overdue: { label: "Vencidas", hint: "Turnos y casos abiertos con el plazo vencido." },
  validation: { label: "Por validar", hint: "Atendidos por la dependencia; falta que Comunicación valide y cierre." },
};
/** A department works what is assigned to it: no triage or unassigned views. */
export const VIEWS_BY_SCOPE: Record<InboxScope, readonly InboxView[]> = {
  editor: INBOX_VIEWS,
  department: ["urgent", "acceptance", "overdue", "validation"],
};
export type ViewCounts = Record<InboxView, number> & { review: number };

/** Sort key of a queue row; also the cursor of the next page. */
export type QueueCursor = { urgency: number; due_at: string | null; item_at: string; kind: "mention" | "case"; id: string };

export const queueKey = (kind: "mention" | "case", id: string) => `${kind}:${id}`;

/** Appends a page keeping the first occurrence of each key (no duplicates across pages). */
export function appendUnique<T extends { key: string }>(current: readonly T[], page: readonly T[]): T[] {
  const seen = new Set(current.map((e) => e.key));
  const out = [...current];
  for (const e of page) {
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    out.push(e);
  }
  return out;
}

/** Same order as public.inbox_queue: urgency desc, due date (none last), age, kind, id. */
export function compareQueue(a: QueueCursor, b: QueueCursor): number {
  const due = (c: QueueCursor) => (c.due_at ? new Date(c.due_at).getTime() : Number.POSITIVE_INFINITY);
  return (
    b.urgency - a.urgency ||
    due(a) - due(b) ||
    new Date(a.item_at).getTime() - new Date(b.item_at).getTime() ||
    a.kind.localeCompare(b.kind) ||
    a.id.localeCompare(b.id)
  );
}

/** The URL filters the queue functions take (view and status are not row filters). */
export function queueFilters(filters: InboxFilters): Record<string, string> {
  return Object.fromEntries(Object.entries(filters).filter(([k, v]) => v && k !== "view" && k !== "status")) as Record<string, string>;
}

/** Outcome of a bulk action, item by item. */
export type BulkFailure = { id: string; reason: string };
export function bulkMessage(done: string, updated: number, failed: readonly BulkFailure[]): string {
  const ok = `${updated} ${updated === 1 ? "actualizada" : "actualizadas"} (${done})`;
  if (!failed.length) return `${ok}.`;
  const reasons = [...new Set(failed.map((f) => f.reason))].join("; ");
  return `${ok}; ${failed.length} sin cambio: ${reasons}.`;
}

export const SOURCE_LABELS: Record<SourceType, string> = { meta: "Facebook", rss: "RSS", youtube: "YouTube", x: "X" };

export const SENTIMENTS = Object.keys(SENTIMENT_LABELS) as Sentiment[];
export const PRIORITIES = ["critical", "high", "medium", "low"] as const satisfies readonly Priority[];
export const TRIAGES = Object.keys(TRIAGE_LABELS) as TriageStatus[];
export const TICKET_STATUSES = Object.keys(TICKET_LABELS) as TicketStatus[];
export const INTENTS = Object.keys(INTENT_LABELS);
export const OPEN_TICKET: readonly TicketStatus[] = ["open", "in_progress"];

/**
 * Status filter values. Empty means the working set: everything but discarded
 * for editors, open and in-progress tickets for a department.
 */
export const EDITOR_STATUS_OPTIONS = [...TRIAGES, "unclassified", "all"] as const;
export const DEPARTMENT_STATUS_OPTIONS = [...TICKET_STATUSES, "overdue", "all"] as const;
export const STATUS_OPTION_LABELS: Record<string, string> = {
  ...TRIAGE_LABELS,
  ...TICKET_LABELS,
  unclassified: "Sin clasificar",
  overdue: "Vencidos",
  all: "Todos",
};

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const guid = z.guid();
const optional = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

export const filtersSchema = z.object({
  q: optional(z.string().trim().max(200)),
  from: optional(date),
  to: optional(date),
  source: optional(guid),
  sentiment: optional(z.enum(SENTIMENTS)),
  topic: optional(z.string().trim().min(1).max(80)),
  department: optional(guid),
  neighborhood: optional(guid),
  priority: optional(z.enum(PRIORITIES)),
  status: optional(z.enum([...EDITOR_STATUS_OPTIONS, ...DEPARTMENT_STATUS_OPTIONS])),
  /** One mention (links from the dashboard ranking). */
  mention: optional(guid),
  /** Mentions by one media outlet or public figure (dashboard ranking). */
  author: optional(guid),
  /** Operational view (absent: every mention, newest first). */
  view: optional(z.enum(INBOX_VIEWS)),
});
export type InboxFilters = z.infer<typeof filtersSchema>;
export const FILTER_KEYS = Object.keys(filtersSchema.shape) as (keyof InboxFilters)[];

/** Reads filters from URL params, dropping anything malformed instead of failing. */
export function parseFilters(params: Record<string, string | string[] | undefined> | URLSearchParams): InboxFilters {
  const raw: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const value = params instanceof URLSearchParams ? params.get(key) : params[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (first) raw[key] = first;
  }
  const parsed = filtersSchema.parse(raw);
  return Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined && v !== "")) as InboxFilters;
}

export function filtersToSearch(filters: InboxFilters): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Status values that make sense for a scope; others are ignored. */
export function statusFor(scope: InboxScope, status: InboxFilters["status"]): InboxFilters["status"] {
  const allowed: readonly string[] = scope === "editor" ? EDITOR_STATUS_OPTIONS : DEPARTMENT_STATUS_OPTIONS;
  return status && allowed.includes(status) ? status : undefined;
}

// Mexico City has no DST since 2022: a calendar day there is UTC-6.
const MX_OFFSET = "-06:00";
export function dayStart(day: string): string {
  return new Date(`${day}T00:00:00${MX_OFFSET}`).toISOString();
}
export function dayEnd(day: string): string {
  return new Date(new Date(`${day}T00:00:00${MX_OFFSET}`).getTime() + 86_400_000).toISOString();
}

/** Hours to attend a routed mention, by priority (the org's SLA, sla_policies). */
export type SlaHours = Record<Priority, number>;

/** SLA used when an org has not set its own. */
export const DUE_HOURS: SlaHours = { critical: 12, high: 24, medium: 72, low: 168 };

/** The org's SLA rows over the defaults. */
export function slaFromRows(rows: readonly { priority: Priority; hours: number }[]): SlaHours {
  return { ...DUE_HOURS, ...Object.fromEntries(rows.map((r) => [r.priority, r.hours])) };
}

/** "12 h", "3 días", "1 día 12 h". */
export function formatHours(hours: number): string {
  if (hours < 48 && hours % 24 !== 0) return `${hours} h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return `${days} ${days === 1 ? "día" : "días"}${rest ? ` ${rest} h` : ""}`;
}

export function defaultDueAt(priority: Priority | null | undefined, now = new Date(), sla: SlaHours = DUE_HOURS): Date {
  return new Date(now.getTime() + sla[priority ?? "medium"] * 3_600_000);
}

export type TicketLike = { status: TicketStatus; due_at: string | null };

export function isOverdue(ticket: TicketLike, now = Date.now()): boolean {
  return OPEN_TICKET.includes(ticket.status) && ticket.due_at != null && new Date(ticket.due_at).getTime() < now;
}

/** Keyset cursor for (published_at desc, id desc). */
export type Cursor = { publishedAt: string; id: string };

export function cursorFilter(cursor: Cursor): string {
  // Values are quoted: timestamps contain ':' and '+', which PostgREST's or() would split on.
  return `published_at.lt."${cursor.publishedAt}",and(published_at.eq."${cursor.publishedAt}",id.lt.${cursor.id})`;
}

/** Inserts or replaces an item keeping (published_at desc, id desc) order. */
export function upsertSorted<T extends { id: string; published_at: string }>(items: readonly T[], item: T): T[] {
  const rest = items.filter((i) => i.id !== item.id);
  const key = (i: T) => [new Date(i.published_at).getTime(), i.id] as const;
  const [t, id] = key(item);
  const at = rest.findIndex((i) => {
    const [ti, idi] = key(i);
    return ti < t || (ti === t && idi < id);
  });
  return at === -1 ? [...rest, item] : [...rest.slice(0, at), item, ...rest.slice(at)];
}

/** datetime-local value (local wall time) ⇄ ISO. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
