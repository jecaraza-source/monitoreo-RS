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
  queueFilters,
  queueKey,
  statusFor,
  type Cursor,
  type InboxFilters,
  type InboxScope,
  type InboxView,
  type Priority,
  type QueueCursor,
  type Sentiment,
  type Severity,
  type TicketStatus,
  type TriageStatus,
  type ViewCounts,
} from "./model";

type Client = SupabaseClient<Database>;

export type InboxTicket = {
  id: string;
  department_id: string;
  status: TicketStatus;
  due_at: string | null;
  resolved_at: string | null;
  created_at: string;
  /** When the department's responsible was notified on WhatsApp. */
  whatsapp_notified_at: string | null;
  /** The department that leads the mention; the others support it. */
  is_primary: boolean;
  /** Set when the ticket is an assignment of a case: its state follows the case. */
  case_id: string | null;
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
  /** Gravedad del hecho, separada del sentimiento (null: clasificada antes de la etapa 5). */
  severity: Severity | null;
  incident_type: string | null;
  needs_attention: boolean | null;
  confirmed_at: string | null;
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
  /** The case the mention belongs to, if any (one at most). */
  case: { id: string; folio: string; status: Database["public"]["Enums"]["case_status"] } | null;
};

// classifications is one-to-one (mention_id is unique), but its foreign key is
// composite (org_id, mention_id), so PostgREST embeds it as an array.
type RawCase = { case_id: string; cases: { folio: string; status: Database["public"]["Enums"]["case_status"] } | null };
type RawItem = Omit<InboxItem, "classifications" | "case"> & {
  classifications: InboxClassification | InboxClassification[] | null;
  case_mentions?: RawCase | RawCase[] | null;
};

function normalize(row: RawItem): InboxItem {
  const c = row.classifications;
  // The leading department first.
  const tickets = [...(row.tickets ?? [])].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  const { case_mentions: links, ...rest } = row;
  const link = Array.isArray(links) ? links[0] : links;
  return {
    ...rest,
    tickets,
    classifications: Array.isArray(c) ? (c[0] ?? null) : c,
    case: link?.cases ? { id: link.case_id, folio: link.cases.folio, status: link.cases.status } : null,
  };
}

export type InboxPage = { items: InboxItem[]; next: Cursor | null; total: number | null };

const CLASSIFICATION =
  "sentiment, confidence, emotion, topic, intent, priority, department_id, neighborhood_id, corrected_by, corrected_at, model, severity, incident_type, needs_attention, confirmed_at";
const TICKET = "id, department_id, status, due_at, resolved_at, created_at, whatsapp_notified_at, is_primary, case_id";
const BASE = "id, text, url, published_at, status, triage, source_id, authors(display_name, handle, kind)";

function selectFor(scope: InboxScope, filters: InboxFilters): string {
  const filtersClassification = Boolean(
    filters.sentiment || filters.topic || filters.department || filters.neighborhood || filters.priority,
  );
  const c = `classifications${filtersClassification ? "!inner" : ""}(${CLASSIFICATION})`;
  // A department works tickets: only mentions with one of its tickets.
  const t = `tickets${scope === "department" ? "!inner" : ""}(${TICKET})`;
  return `${BASE}, ${c}, ${t}, case_mentions(case_id, cases(folio, status))`;
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

export type InboxNote = { id: string; author_name: string; body: string; created_at: string; channel: string };

export async function fetchNotes(supabase: Client, mentionId: string): Promise<InboxNote[]> {
  const { data } = await supabase
    .from("mention_notes")
    .select("id, author_name, body, created_at, channel")
    .eq("mention_id", mentionId)
    .order("created_at");
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Operational views: order and membership come from public.inbox_queue (RLS
// applies), the cards from the same reads as the chronological inbox.
// ---------------------------------------------------------------------------

export type QueueCase = {
  id: string;
  folio: string;
  title: string;
  status: Database["public"]["Enums"]["case_status"];
  priority: Priority;
  department_id: string | null;
  neighborhood_id: string | null;
  due_at: string | null;
  accept_due_at: string | null;
  opened_at: string;
  mentions: number;
};

export type QueueEntry =
  | { key: string; kind: "mention"; sort: QueueCursor; mention: InboxItem }
  | { key: string; kind: "case"; sort: QueueCursor; case: QueueCase };

export type QueuePage = { entries: QueueEntry[]; next: QueueCursor | null };

export async function fetchQueue(
  supabase: Client,
  orgId: string,
  scope: InboxScope,
  view: InboxView,
  filters: InboxFilters,
  cursor: QueueCursor | null = null,
): Promise<QueuePage> {
  const { data, error } = await supabase.rpc("inbox_queue", {
    p_org_id: orgId,
    p_view: view,
    p_filters: queueFilters(filters),
    p_cursor: cursor ?? undefined,
    p_limit: PAGE_SIZE,
  });
  if (error) throw new Error(`No se pudo cargar la vista: ${error.message}`);
  const rows = (data ?? []) as QueueCursor[];
  return { entries: await hydrate(supabase, orgId, scope, rows), next: rows.length === PAGE_SIZE ? rows[rows.length - 1] : null };
}

/** Loads the cards of queue rows, in the queue's order. Rows that vanished meanwhile are skipped. */
export async function hydrate(supabase: Client, orgId: string, scope: InboxScope, rows: readonly QueueCursor[]): Promise<QueueEntry[]> {
  const mentionIds = rows.filter((r) => r.kind === "mention").map((r) => r.id);
  const caseIds = rows.filter((r) => r.kind === "case").map((r) => r.id);
  const [mentions, cases] = await Promise.all([
    mentionIds.length ? fetchInbox(supabase, orgId, scope, { status: "all" }, { ids: mentionIds }) : Promise.resolve({ items: [] as InboxItem[] }),
    caseIds.length
      ? supabase
          .from("cases")
          .select("id, folio, title, status, priority, department_id, neighborhood_id, due_at, accept_due_at, opened_at, case_mentions(count)")
          .eq("org_id", orgId)
          .in("id", caseIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const byMention = new Map(mentions.items.map((m) => [m.id, m]));
  const byCase = new Map(
    ((cases.data ?? []) as unknown as (Omit<QueueCase, "mentions" | "folio"> & { folio: string | null; case_mentions: { count: number }[] })[]).map(
      ({ case_mentions, folio, ...c }) => [c.id, { ...c, folio: folio ?? "", mentions: case_mentions[0]?.count ?? 0 }],
    ),
  );
  const entries: QueueEntry[] = [];
  for (const sort of rows) {
    if (sort.kind === "mention") {
      const mention = byMention.get(sort.id);
      if (mention) entries.push({ key: queueKey("mention", sort.id), kind: "mention", sort, mention });
    } else {
      const c = byCase.get(sort.id);
      if (c) entries.push({ key: queueKey("case", sort.id), kind: "case", sort, case: c });
    }
  }
  return entries;
}

/** Counters of every view for these filters (same predicate as the lists). */
export async function fetchCounts(supabase: Client, orgId: string, filters: InboxFilters): Promise<ViewCounts | null> {
  const { data, error } = await supabase.rpc("inbox_counts", { p_org_id: orgId, p_filters: queueFilters(filters) });
  if (error) return null;
  return data as ViewCounts;
}
