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

/** Default response time when routing, by priority (hours). */
export const DUE_HOURS: Record<Priority, number> = { critical: 12, high: 24, medium: 72, low: 168 };

export function defaultDueAt(priority: Priority | null | undefined, now = new Date()): Date {
  return new Date(now.getTime() + DUE_HOURS[priority ?? "medium"] * 3_600_000);
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
