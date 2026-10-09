// Inbox reads. Works with the server or the browser Supabase client: RLS
// decides what each role sees (a department only gets mentions routed to it).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  cursorFilter,
  dayEnd,
  dayStart,
  OPEN_TICKET,
  PAGE_SIZE,
  statusFor,
  type Cursor,
  type InboxFilters,
  type InboxScope,
  type Priority,
  type Sentiment,
  type TicketStatus,
  type TriageStatus,
} from "./model";

type Client = SupabaseClient<Database>;

export type InboxTicket = {
  id: string;
  department_id: string;
  status: TicketStatus;
  due_at: string | null;
  resolved_at: string | null;
  created_at: string;
};

export type InboxClassification = {
  sentiment: Sentiment;
  confidence: number | null;
  emotion: string | null;
  topic: string | null;
  intent: string | null;
  priority: Priority;
  department_id: string | null;
  neighborhood_id: string | null;
  corrected_by: string | null;
  corrected_at: string | null;
  model: string;
};

export type InboxItem = {
  id: string;
  text: string;
  url: string | null;
  published_at: string;
  status: Database["public"]["Enums"]["mention_status"];
  triage: TriageStatus;
  source_id: string;
  authors: { display_name: string | null; handle: string; kind: Database["public"]["Enums"]["author_kind"] } | null;
  classifications: InboxClassification | null;
  tickets: InboxTicket[];
};

// classifications is one-to-one (mention_id is unique), but its foreign key is
// composite (org_id, mention_id), so PostgREST embeds it as an array.
type RawItem = Omit<InboxItem, "classifications"> & { classifications: InboxClassification | InboxClassification[] | null };

function normalize(row: RawItem): InboxItem {
  const c = row.classifications;
  return { ...row, classifications: Array.isArray(c) ? (c[0] ?? null) : c };
}

export type InboxPage = { items: InboxItem[]; next: Cursor | null; total: number | null };

const CLASSIFICATION =
  "sentiment, confidence, emotion, topic, intent, priority, department_id, neighborhood_id, corrected_by, corrected_at, model";
const TICKET = "id, department_id, status, due_at, resolved_at, created_at";
const BASE = "id, text, url, published_at, status, triage, source_id, authors(display_name, handle, kind)";

function selectFor(scope: InboxScope, filters: InboxFilters): string {
  const filtersClassification = Boolean(
    filters.sentiment || filters.topic || filters.department || filters.neighborhood || filters.priority,
  );
  const c = `classifications${filtersClassification ? "!inner" : ""}(${CLASSIFICATION})`;
  // A department works tickets: only mentions with one of its tickets.
  const t = `tickets${scope === "department" ? "!inner" : ""}(${TICKET})`;
  return `${BASE}, ${c}, ${t}`;
}

export async function fetchInbox(
  supabase: Client,
  orgId: string,
  scope: InboxScope,
  filters: InboxFilters,
  options: { cursor?: Cursor | null; ids?: string[]; count?: boolean } = {},
): Promise<InboxPage> {
  let query = supabase
    .from("mentions")
    .select(selectFor(scope, filters), options.count ? { count: "exact" } : undefined)
    .eq("org_id", orgId);

  if (options.ids) query = query.in("id", options.ids);
  if (filters.q) query = query.textSearch("search", filters.q, { config: "spanish_unaccent", type: "websearch" });
  if (filters.from) query = query.gte("published_at", dayStart(filters.from));
  if (filters.to) query = query.lt("published_at", dayEnd(filters.to));
  if (filters.source) query = query.eq("source_id", filters.source);
  if (filters.mention) query = query.eq("id", filters.mention);
  if (filters.author) query = query.eq("author_id", filters.author);
  if (filters.sentiment) query = query.eq("classifications.sentiment", filters.sentiment);
  if (filters.topic) query = query.eq("classifications.topic", filters.topic);
  if (filters.department) query = query.eq("classifications.department_id", filters.department);
  if (filters.neighborhood) query = query.eq("classifications.neighborhood_id", filters.neighborhood);
  if (filters.priority) query = query.eq("classifications.priority", filters.priority);

  const status = statusFor(scope, filters.status);
  if (scope === "editor") {
    if (!status) query = query.neq("triage", "discarded");
    else if (status === "unclassified") query = query.in("status", ["pending", "failed"]);
    else if (status !== "all") query = query.eq("triage", status as TriageStatus);
  } else {
    if (!status) query = query.in("tickets.status", OPEN_TICKET);
    else if (status === "overdue") query = query.in("tickets.status", OPEN_TICKET).lt("tickets.due_at", new Date().toISOString());
    else if (status !== "all") query = query.eq("tickets.status", status as TicketStatus);
  }

  if (options.cursor) query = query.or(cursorFilter(options.cursor));
  query = query.order("published_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE_SIZE);

  const { data, error, count } = await query;
  if (error) throw new Error(`No se pudo cargar la bandeja: ${error.message}`);
  const items = ((data ?? []) as unknown as RawItem[]).map(normalize);
  const last = items.at(-1);
  return {
    items,
    next: items.length === PAGE_SIZE && last ? { publishedAt: last.published_at, id: last.id } : null,
    total: count ?? null,
  };
}

/** The item if it still matches the filters, else null (used by Realtime refreshes). */
export async function fetchInboxItem(
  supabase: Client,
  orgId: string,
  scope: InboxScope,
  filters: InboxFilters,
  id: string,
): Promise<InboxItem | null> {
  const page = await fetchInbox(supabase, orgId, scope, filters, { ids: [id] });
  return page.items[0] ?? null;
}

/** Open tickets past their due date that the user can see (RLS-scoped). */
export async function countOverdue(supabase: Client, orgId: string): Promise<number> {
  const { count } = await supabase
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .in("status", OPEN_TICKET)
    .lt("due_at", new Date().toISOString());
  return count ?? 0;
}

export type InboxNote = { id: string; author_name: string; body: string; created_at: string };

export async function fetchNotes(supabase: Client, mentionId: string): Promise<InboxNote[]> {
  const { data } = await supabase
    .from("mention_notes")
    .select("id, author_name, body, created_at")
    .eq("mention_id", mentionId)
    .order("created_at");
  return data ?? [];
}
