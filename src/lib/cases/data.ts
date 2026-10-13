import "server-only";
import type { Member } from "@/lib/auth/session";
import { PRIORITIES, type Priority, type Sentiment, type TicketStatus } from "@/lib/inbox/model";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { CASE_STATUSES, OPEN_CASE_STATUSES, type CaseStatus } from "./model";

// Reads for /casos. RLS decides what each role gets: a department only sees
// the cases assigned to it, without internal notes or internal history.

export const CASES_PAGE = 50;

export type CaseFilters = {
  /** "open" (default), "all", or one status. */
  status?: string;
  department?: string;
  neighborhood?: string;
  priority?: string;
  q?: string;
  page?: number;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCaseFilters(params: Record<string, string | string[] | undefined>): CaseFilters {
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  const status = one("estado");
  const page = Number(one("pagina"));
  return {
    status: status === "all" || (CASE_STATUSES as readonly string[]).includes(status ?? "") ? status : "open",
    department: uuid.test(one("dependencia") ?? "") ? one("dependencia") : undefined,
    neighborhood: uuid.test(one("colonia") ?? "") ? one("colonia") : undefined,
    priority: (PRIORITIES as readonly string[]).includes(one("prioridad") ?? "") ? one("prioridad") : undefined,
    q: one("q")?.trim().slice(0, 100) || undefined,
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

export type CaseRow = {
  id: string;
  folio: string;
  title: string;
  category: string | null;
  status: CaseStatus;
  priority: Priority;
  department_id: string | null;
  neighborhood_id: string | null;
  due_at: string | null;
  opened_at: string;
  updated_at: string;
  mentions: number;
};

export async function listCases(member: Member, filters: CaseFilters): Promise<{ rows: CaseRow[]; total: number }> {
  const supabase = await createClient();
  const page = filters.page ?? 1;
  let query = supabase
    .from("cases")
    .select("id, folio, title, category, status, priority, department_id, neighborhood_id, due_at, opened_at, updated_at, case_mentions(count)", {
      count: "exact",
    })
    .eq("org_id", member.orgId);
  if (filters.status === "open" || !filters.status) query = query.in("status", [...OPEN_CASE_STATUSES]);
  else if (filters.status !== "all") query = query.eq("status", filters.status as CaseStatus);
  if (filters.department) query = query.eq("department_id", filters.department);
  if (filters.neighborhood) query = query.eq("neighborhood_id", filters.neighborhood);
  if (filters.priority) query = query.eq("priority", filters.priority as Priority);
  if (filters.q) {
    const folio = /^c-?(\d{1,7})$/i.exec(filters.q);
    query = folio
      ? query.eq("number", Number(folio[1]))
      : query.ilike("title", `%${filters.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  }
  const { data, error, count } = await query
    .order("updated_at", { ascending: false })
    .order("id")
    .range((page - 1) * CASES_PAGE, page * CASES_PAGE - 1);
  if (error) throw new Error(`No se pudieron cargar los casos: ${error.message}`);
  const rows = (data ?? []).map(({ case_mentions, ...c }) => ({
    ...c,
    // Generated column: never null, but typed as nullable.
    folio: c.folio ?? "",
    mentions: (case_mentions as unknown as { count: number }[])[0]?.count ?? 0,
  }));
  return { rows, total: count ?? rows.length };
}

export type CaseMention = {
  id: string;
  text: string;
  url: string | null;
  published_at: string;
  source_id: string;
  /** The author of the publication (not of the case). */
  author: { name: string; kind: Database["public"]["Enums"]["author_kind"] } | null;
  sentiment: Sentiment | null;
  topic: string | null;
  neighborhood_id: string | null;
  added_at: string;
  reason: string | null;
  primary: boolean;
};

export type CaseTicket = {
  id: string;
  department_id: string;
  is_primary: boolean;
  status: TicketStatus;
  due_at: string | null;
  resolved_at: string | null;
  whatsapp_notified_at: string | null;
};

export type CaseEvent = {
  id: number;
  at: string;
  actor_name: string;
  actor_kind: string;
  operation: string;
  from_status: CaseStatus | null;
  to_status: CaseStatus | null;
  reason: string | null;
  changes: Record<string, unknown>;
  internal: boolean;
};

export type CaseNote = { id: string; author_name: string; body: string; visibility: "internal" | "department"; created_at: string };

export type CaseDetail = Database["public"]["Tables"]["cases"]["Row"] & {
  mentions: CaseMention[];
  tickets: CaseTicket[];
  events: CaseEvent[];
  notes: CaseNote[];
  people: { user_id: string; name: string; is_responsible: boolean }[];
  mergedInto: { id: string; folio: string } | null;
};

type RawClassification = { sentiment: Sentiment; topic: string | null; neighborhood_id: string | null };
type RawMention = {
  mention_id: string;
  added_at: string;
  reason: string | null;
  mentions: {
    id: string;
    text: string;
    url: string | null;
    published_at: string;
    source_id: string;
    authors: { display_name: string | null; handle: string; kind: Database["public"]["Enums"]["author_kind"] } | null;
    // One-to-one, but embedded as an array because its foreign key is composite.
    classifications: RawClassification | RawClassification[] | null;
  } | null;
};

export async function getCase(member: Member, id: string): Promise<CaseDetail | null> {
  if (!uuid.test(id)) return null;
  const supabase = await createClient();
  const { data: row, error } = await supabase.from("cases").select("*").eq("org_id", member.orgId).eq("id", id).maybeSingle();
  if (error) throw new Error(`No se pudo cargar el caso: ${error.message}`);
  if (!row) return null;

  const [mentions, tickets, events, notes, people, merged] = await Promise.all([
    supabase
      .from("case_mentions")
      .select(
        "mention_id, added_at, reason, mentions(id, text, url, published_at, source_id, authors(display_name, handle, kind), classifications(sentiment, topic, neighborhood_id))",
      )
      .eq("case_id", id),
    supabase
      .from("tickets")
      .select("id, department_id, is_primary, status, due_at, resolved_at, whatsapp_notified_at")
      .eq("case_id", id)
      .order("is_primary", { ascending: false })
      .order("created_at"),
    supabase
      .from("case_events")
      .select("id, at, actor_name, actor_kind, operation, from_status, to_status, reason, changes, internal")
      .eq("case_id", id)
      .order("at", { ascending: false })
      .order("id", { ascending: false })
      .limit(500),
    supabase.from("case_notes").select("id, author_name, body, visibility, created_at").eq("case_id", id).order("created_at", { ascending: false }),
    supabase.rpc("case_people", { p_case_id: id }),
    row.merged_into_id
      ? supabase.from("cases").select("id, folio").eq("id", row.merged_into_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const list = ((mentions.data ?? []) as unknown as RawMention[])
    .filter((m) => m.mentions)
    .map((m): CaseMention => {
      const x = m.mentions!;
      const cls = Array.isArray(x.classifications) ? x.classifications[0] : x.classifications;
      return {
        id: x.id,
        text: x.text,
        url: x.url,
        published_at: x.published_at,
        source_id: x.source_id,
        author: x.authors ? { name: x.authors.display_name ?? `@${x.authors.handle}`, kind: x.authors.kind } : null,
        sentiment: cls?.sentiment ?? null,
        topic: cls?.topic ?? null,
        neighborhood_id: cls?.neighborhood_id ?? null,
        added_at: m.added_at,
        reason: m.reason,
        primary: x.id === row.primary_mention_id,
      };
    })
    .sort((a, b) => Number(b.primary) - Number(a.primary) || b.published_at.localeCompare(a.published_at));

  return {
    ...row,
    mentions: list,
    tickets: (tickets.data ?? []) as CaseTicket[],
    events: (events.data ?? []) as CaseEvent[],
    notes: (notes.data ?? []) as CaseNote[],
    people: people.data ?? [],
    mergedInto: merged.data ? { id: merged.data.id, folio: merged.data.folio ?? "" } : null,
  };
}

export type CaseSuggestion = {
  id: string;
  text: string;
  published_at: string;
  same_neighborhood: boolean;
  same_topic: boolean;
  word_overlap: number;
  hours_apart: number;
};

/** Mentions that may be about the same problem; a person decides. Editors only. */
export async function getSuggestions(caseId: string): Promise<CaseSuggestion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("suggest_case_mentions", { p_case_id: caseId, p_limit: 10 });
  if (error || !data?.length) return [];
  const { data: texts } = await supabase.from("mentions").select("id, text, published_at").in("id", data.map((s) => s.mention_id));
  const byId = new Map((texts ?? []).map((t) => [t.id, t]));
  return data
    .filter((s) => byId.has(s.mention_id))
    .map((s) => ({
      id: s.mention_id,
      text: byId.get(s.mention_id)!.text,
      published_at: byId.get(s.mention_id)!.published_at,
      same_neighborhood: s.same_neighborhood,
      same_topic: s.same_topic,
      word_overlap: Number(s.word_overlap),
      hours_apart: Number(s.hours_apart),
    }));
}

/** Other open cases of the municipality, to merge into this one. */
export async function getMergeCandidates(member: Member, caseId: string): Promise<{ id: string; folio: string; title: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("cases")
    .select("id, folio, title")
    .eq("org_id", member.orgId)
    .neq("id", caseId)
    .neq("status", "merged")
    .order("updated_at", { ascending: false })
    .limit(200);
  return (data ?? []).map((c) => ({ ...c, folio: c.folio ?? "" }));
}
