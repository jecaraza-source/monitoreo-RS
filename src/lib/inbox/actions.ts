"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { notifyRoutedTickets } from "@/lib/whatsapp/turns";
import { processStatsInvalidations } from "@/lib/dashboard/refresh";
import { bulkMessage, INCIDENT_TYPES, INTENTS, PRIORITIES, SENTIMENTS, SEVERITIES, TICKET_STATUSES, TRIAGES, type BulkFailure } from "./model";

export type InboxActionResult =
  | { ok: true; message: string; updated?: number; failed?: BulkFailure[] }
  | { ok: false; message: string; failed?: BulkFailure[] };

const EDITORS = ["admin", "comunicacion"] as const;
const WORKERS = ["admin", "comunicacion", "dependencia"] as const;
const FORBIDDEN: InboxActionResult = { ok: false, message: "No tienes permiso para esta acción." };

async function member(roles: readonly ("admin" | "comunicacion" | "dependencia")[]) {
  try {
    return await requireRole(roles);
  } catch {
    return null;
  }
}

const id = z.guid("Identificador inválido.");
const ids = z.array(id).min(1, "Selecciona al menos una mención.").max(500, "Demasiadas menciones a la vez.");

function fail(error: { code?: string; message: string } | null, what: string): InboxActionResult {
  console.error(`[inbox] ${what}:`, error?.code, error?.message);
  if (error?.code === "42501") return FORBIDDEN;
  // Rule violations the database explains in Spanish (e.g. a mention that belongs to a case).
  if (error?.code === "22023") return { ok: false, message: error.message };
  return { ok: false, message: `No se pudo ${what}.` };
}

// ---------------------------------------------------------------------------
// Triage (comunicación)
// ---------------------------------------------------------------------------

// "routed" is accepted only to undo a discard; routing itself goes through routeMentions.
const triageSchema = z.object({ ids, triage: z.enum(TRIAGES) });

export async function setTriage(input: unknown): Promise<InboxActionResult> {
  const m = await member(EDITORS);
  if (!m) return FORBIDDEN;
  const parsed = triageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { ids: requested, triage } = parsed.data;
  const mentionIds = [...new Set(requested)];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mentions")
    .update({ triage })
    .eq("org_id", m.orgId)
    .in("id", mentionIds)
    .select("id");
  if (error) return fail(error, "cambiar el estado");
  // What the database actually changed; the rest did not exist or was not visible.
  const changed = new Set((data ?? []).map((r) => r.id));
  const failed = mentionIds.filter((x) => !changed.has(x)).map((x) => ({ id: x, reason: "no encontrada o sin permiso" }));
  const done = {
    new: "marcadas como nuevas",
    reviewed: "marcadas como revisadas",
    discarded: "descartadas",
    routed: "restauradas",
  }[triage];
  if (!changed.size) return { ok: false, message: "No se actualizó ninguna mención.", failed };
  return { ok: true, message: bulkMessage(done, changed.size, failed), updated: changed.size, failed };
}

// ---------------------------------------------------------------------------
// Routing (comunicación)
// ---------------------------------------------------------------------------

const routeSchema = z
  .object({
    ids,
    departmentId: id,
    /** Departments that support the leading one (e.g. Obras Públicas on a water leak). */
    supportIds: z.array(id).max(4, "Máximo 4 dependencias de apoyo.").default([]),
    dueAt: z.iso.datetime({ offset: true, message: "Fecha límite inválida." }),
    note: z.string().trim().max(2000).optional(),
    /** The person read the incident policy of the emergencies in the selection. */
    emergencyAck: z.boolean().default(false),
  })
  .transform((r) => ({ ...r, supportIds: [...new Set(r.supportIds)].filter((d) => d !== r.departmentId) }));

/** "A", "A y B", "A, B y C". */
const joinNames = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`);

export async function routeMentions(input: unknown): Promise<InboxActionResult> {
  const m = await member(EDITORS);
  if (!m) return FORBIDDEN;
  const parsed = routeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { ids: requested, departmentId, supportIds, dueAt, note, emergencyAck } = parsed.data;
  if (new Date(dueAt).getTime() < Date.now() - 60_000) return { ok: false, message: "La fecha límite ya pasó." };

  const supabase = await createClient();
  const { data: departments } = await supabase
    .from("departments")
    .select("id, name")
    .eq("org_id", m.orgId)
    .in("id", [departmentId, ...supportIds]);
  const name = new Map((departments ?? []).map((d) => [d.id, d.name]));
  if (!name.has(departmentId) || supportIds.some((d) => !name.has(d))) return { ok: false, message: "Dependencia no encontrada." };

  // Item by item: what cannot be routed is reported, the rest goes ahead.
  const wanted = [...new Set(requested)];
  const [{ data: visible }, { data: inCase }] = await Promise.all([
    supabase.from("mentions").select("id, classifications(severity)").eq("org_id", m.orgId).in("id", wanted),
    supabase.from("case_mentions").select("mention_id, cases(folio)").eq("org_id", m.orgId).in("mention_id", wanted),
  ]);
  const caseOf = new Map(
    ((inCase ?? []) as unknown as { mention_id: string; cases: { folio: string | null } | null }[]).map((r) => [r.mention_id, r.cases?.folio ?? "un caso"]),
  );
  const found = new Set((visible ?? []).map((r) => r.id));
  const failed: BulkFailure[] = [];
  for (const x of wanted) {
    if (!found.has(x)) failed.push({ id: x, reason: "no encontrada o sin permiso" });
    else if (caseOf.has(x)) failed.push({ id: x, reason: `pertenece a ${caseOf.get(x)}: se asigna desde el caso` });
  }
  const mentionIds = wanted.filter((x) => found.has(x) && !caseOf.has(x));
  if (!mentionIds.length) return { ok: false, message: "No se turnó ninguna mención.", failed };

  // Emergencies go to the institutional channel first (incident_policies).
  const severityOf = (r: { classifications: unknown }) => {
    const c = r.classifications as { severity: string | null } | { severity: string | null }[] | null;
    return (Array.isArray(c) ? c[0] : c)?.severity ?? null;
  };
  const emergencies = (visible ?? []).filter((r) => mentionIds.includes(r.id) && severityOf(r) === "emergency").length;
  if (emergencies && !emergencyAck) {
    return { ok: false, message: "Hay emergencias en la selección: confirma que se siguió la política del canal institucional." };
  }

  const { data: routed, error } = await supabase.rpc("route_mentions", {
    p_mention_ids: mentionIds,
    p_department_id: departmentId,
    p_due_at: dueAt,
    p_support_ids: supportIds,
  });
  if (error) return { ...fail(error, "turnar"), failed };

  if (note) {
    const { error: noteError } = await supabase
      .from("mention_notes")
      .insert(mentionIds.map((mentionId) => ({ org_id: m.orgId, mention_id: mentionId, body: note })));
    if (noteError) console.error("[inbox] route note:", noteError.code);
  }
  const n = mentionIds.length;
  if (!routed) return { ok: false, message: "No se turnó ninguna mención.", failed };
  const whatsapp = await noticeRouted(m.orgId, [departmentId, ...supportIds], mentionIds);
  const target = supportIds.length
    ? `${name.get(departmentId)} (principal), con apoyo de ${joinNames(supportIds.map((d) => name.get(d)!))}`
    : name.get(departmentId);
  let message = n === 1 ? `Turnada a ${target}.` : `${n} menciones turnadas a ${target}.`;
  if (failed.length) message += ` ${failed.length} sin turnar: ${[...new Set(failed.map((f) => f.reason))].join("; ")}.`;
  if (whatsapp) message += ` Se avisará ${whatsapp === 1 ? "al responsable" : "a los responsables"} por WhatsApp.`;
  return { ok: true, message, updated: n, failed };
}

/**
 * Sends the WhatsApp turn notices after the response, to the responsible of
 * each department with an active number. Returns how many departments will
 * be notified.
 */
async function noticeRouted(orgId: string, departmentIds: string[], mentionIds: string[]): Promise<number> {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) return 0;
  const admin = createAdminClient();
  const { data: departments } = await admin.from("departments").select("id, responsible_user_id").in("id", departmentIds);
  const userIds = (departments ?? []).map((d) => d.responsible_user_id).filter((x): x is string => Boolean(x));
  if (!userIds.length) return 0;
  const { data: contacts } = await admin
    .from("whatsapp_contacts")
    .select("user_id")
    .eq("org_id", orgId)
    .in("user_id", userIds)
    .eq("status", "active");
  const reachable = new Set((contacts ?? []).map((c) => c.user_id));
  const notified = (departments ?? []).filter((d) => d.responsible_user_id && reachable.has(d.responsible_user_id)).map((d) => d.id);
  if (!notified.length) return 0;
  const { data: tickets } = await admin
    .from("tickets")
    .select("id")
    .eq("org_id", orgId)
    .in("department_id", notified)
    .in("mention_id", mentionIds);
  const ids = (tickets ?? []).map((t) => t.id);
  if (!ids.length) return 0;
  after(async () => {
    try {
      await notifyRoutedTickets(admin, ids);
    } catch (error) {
      console.error("[whatsapp] turn notice:", error instanceof Error ? error.message : error);
    }
  });
  return notified.length;
}

// ---------------------------------------------------------------------------
// Ticket status (comunicación or the department that owns the ticket)
// ---------------------------------------------------------------------------

const ticketSchema = z.object({ ticketId: id, status: z.enum(TICKET_STATUSES) });

export async function setTicketStatus(input: unknown): Promise<InboxActionResult> {
  const m = await member(WORKERS);
  if (!m) return FORBIDDEN;
  const parsed = ticketSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { ticketId, status } = parsed.data;
  const done = status === "resolved" || status === "closed";

  const supabase = await createClient();
  // A ticket that is an assignment of a case follows the case: move the case.
  const { data: ticket } = await supabase.from("tickets").select("case_id").eq("org_id", m.orgId).eq("id", ticketId).maybeSingle();
  if (!ticket) return FORBIDDEN;
  if (ticket.case_id) {
    const { error: caseError } = await supabase.rpc("case_ticket_status", { p_ticket_id: ticketId, p_status: status });
    if (caseError) return fail(caseError, "actualizar el caso");
    return { ok: true, message: "Estado del caso actualizado." };
  }
  const { data, error } = await supabase
    .from("tickets")
    .update({ status, resolved_at: done ? new Date().toISOString() : null })
    .eq("org_id", m.orgId)
    .eq("id", ticketId)
    .select("id");
  if (error) return fail(error, "actualizar el ticket");
  // RLS hides tickets of other departments: the update matches nothing.
  if (!data?.length) return FORBIDDEN;
  return { ok: true, message: "Estado del ticket actualizado." };
}

// ---------------------------------------------------------------------------
// Classification corrections (comunicación); the DB stamps corrected_by/at
// ---------------------------------------------------------------------------

const correctionSchema = z.object({
  mentionId: id,
  sentiment: z.enum(SENTIMENTS),
  topic: z.string().trim().min(1, "Elige un tema.").max(80),
  intent: z.enum(INTENTS),
  priority: z.enum(PRIORITIES),
  departmentId: id.nullable(),
  neighborhoodId: id.nullable(),
  // Separate from sentiment: severity of the fact, incident type, need of attention.
  severity: z.enum(SEVERITIES).nullable(),
  incidentType: z.enum(INCIDENT_TYPES as [string, ...string[]]).nullable(),
  needsAttention: z.boolean().nullable(),
  reason: z.string().trim().max(500).optional(),
});

/** The aggregates catch up right away; the durable queue retries if this fails. */
function refreshAggregatesSoon() {
  after(async () => {
    try {
      await processStatsInvalidations(createAdminClient());
    } catch (e) {
      console.error("[dashboard] invalidation:", e instanceof Error ? e.message : e);
    }
  });
}

export async function correctClassification(input: unknown): Promise<InboxActionResult> {
  const m = await member(EDITORS);
  if (!m) return FORBIDDEN;
  const parsed = correctionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const c = parsed.data;

  const supabase = await createClient();
  // The database keeps the previous version and settles a pending review.
  const { data, error } = await supabase.rpc("correct_classification", {
    p_mention_id: c.mentionId,
    p_changes: {
      sentiment: c.sentiment,
      topic: c.topic,
      intent: c.intent,
      priority: c.priority,
      department_id: c.departmentId,
      neighborhood_id: c.neighborhoodId,
      severity: c.severity,
      incident_type: c.incidentType,
      needs_attention: c.needsAttention,
    },
    p_reason: c.reason || undefined,
  });
  if (error) return fail(error, "guardar la corrección");
  const changed = Object.keys((data ?? {}) as Record<string, unknown>).length;
  if (!changed) return { ok: true, message: "Sin cambios." };
  refreshAggregatesSoon();
  return { ok: true, message: "Clasificación corregida. El dashboard se actualiza en unos minutos." };
}

const confirmSchema = z.object({ mentionId: id });

/** Confirms incident type and urgency as they are (no changes to sentiment or anything else). */
export async function confirmClassification(input: unknown): Promise<InboxActionResult> {
  const m = await member(EDITORS);
  if (!m) return FORBIDDEN;
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_classification", { p_mention_id: parsed.data.mentionId });
  if (error) return fail(error, "confirmar");
  return { ok: true, message: "Tipo de incidente y urgencia confirmados." };
}

const reviewSchema = z.object({
  reviewId: id,
  decision: z.enum(["confirmed", "corrected", "dismissed"]),
  changes: z
    .object({
      sentiment: z.enum(SENTIMENTS),
      topic: z.string().trim().min(1).max(80),
      intent: z.enum(INTENTS),
      priority: z.enum(PRIORITIES),
      department_id: id.nullable(),
      neighborhood_id: id.nullable(),
      severity: z.enum(SEVERITIES).nullable(),
      incident_type: z.enum(INCIDENT_TYPES as [string, ...string[]]).nullable(),
      needs_attention: z.boolean().nullable(),
    })
    .partial()
    .default({}),
  reason: z.string().trim().max(500).default(""),
});

/** Human review queue: confirm, correct (with reason) or dismiss (with reason). */
export async function decideReview(input: unknown): Promise<InboxActionResult> {
  const m = await member(EDITORS);
  if (!m) return FORBIDDEN;
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  if (v.decision !== "confirmed" && v.reason.length < 3) return { ok: false, message: "Escribe el motivo de la decisión." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_review", {
    p_review_id: v.reviewId,
    p_decision: v.decision,
    p_changes: v.decision === "corrected" ? v.changes : {},
    p_reason: v.reason || undefined,
  });
  if (error) return fail(error, "guardar la decisión");
  if (v.decision === "corrected") refreshAggregatesSoon();
  revalidatePath("/bandeja/revision");
  return {
    ok: true,
    message: { confirmed: "Clasificación confirmada.", corrected: "Corrección guardada.", dismissed: "Mención descartada." }[v.decision],
  };
}

// ---------------------------------------------------------------------------
// Notes (comunicación, or the department the mention was routed to)
// ---------------------------------------------------------------------------

const noteSchema = z.object({
  mentionId: id,
  body: z.string().trim().min(1, "Escribe la nota.").max(2000, "La nota es muy larga."),
});

export async function addNote(input: unknown): Promise<InboxActionResult> {
  const m = await member(WORKERS);
  if (!m) return FORBIDDEN;
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("mention_notes")
    .insert({ org_id: m.orgId, mention_id: parsed.data.mentionId, body: parsed.data.body });
  if (error) return fail(error, "guardar la nota");
  return { ok: true, message: "Nota agregada." };
}
