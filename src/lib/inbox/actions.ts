"use server";

import { after } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { notifyRoutedTickets } from "@/lib/whatsapp/turns";
import { INTENTS, PRIORITIES, SENTIMENTS, TICKET_STATUSES, TRIAGES } from "./model";

export type InboxActionResult = { ok: true; message: string } | { ok: false; message: string };

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
  const { ids: mentionIds, triage } = parsed.data;

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("mentions")
    .update({ triage }, { count: "exact" })
    .eq("org_id", m.orgId)
    .in("id", mentionIds);
  if (error) return fail(error, "cambiar el estado");
  const n = count ?? mentionIds.length;
  const [one, many] = {
    new: ["marcada como nueva", "marcadas como nuevas"],
    reviewed: ["marcada como revisada", "marcadas como revisadas"],
    discarded: ["descartada", "descartadas"],
    routed: ["restaurada", "restauradas"],
  }[triage];
  return { ok: true, message: n === 1 ? `Mención ${one}.` : `${n} menciones ${many}.` };
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
  })
  .transform((r) => ({ ...r, supportIds: [...new Set(r.supportIds)].filter((d) => d !== r.departmentId) }));

/** "A", "A y B", "A, B y C". */
const joinNames = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`);

export async function routeMentions(input: unknown): Promise<InboxActionResult> {
  const m = await member(EDITORS);
  if (!m) return FORBIDDEN;
  const parsed = routeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { ids: mentionIds, departmentId, supportIds, dueAt, note } = parsed.data;
  if (new Date(dueAt).getTime() < Date.now() - 60_000) return { ok: false, message: "La fecha límite ya pasó." };

  const supabase = await createClient();
  const { data: departments } = await supabase
    .from("departments")
    .select("id, name")
    .eq("org_id", m.orgId)
    .in("id", [departmentId, ...supportIds]);
  const name = new Map((departments ?? []).map((d) => [d.id, d.name]));
  if (!name.has(departmentId) || supportIds.some((d) => !name.has(d))) return { ok: false, message: "Dependencia no encontrada." };

  const { data: routed, error } = await supabase.rpc("route_mentions", {
    p_mention_ids: mentionIds,
    p_department_id: departmentId,
    p_due_at: dueAt,
    p_support_ids: supportIds,
  });
  if (error) return fail(error, "turnar");

  if (note) {
    const { error: noteError } = await supabase
      .from("mention_notes")
      .insert(mentionIds.map((mentionId) => ({ org_id: m.orgId, mention_id: mentionId, body: note })));
    if (noteError) console.error("[inbox] route note:", noteError.code);
  }
  const n = mentionIds.length;
  if (!routed) return { ok: false, message: "No se turnó ninguna mención." };
  const whatsapp = await noticeRouted(m.orgId, [departmentId, ...supportIds], mentionIds);
  const target = supportIds.length
    ? `${name.get(departmentId)} (principal), con apoyo de ${joinNames(supportIds.map((d) => name.get(d)!))}`
    : name.get(departmentId);
  const base = n === 1 ? `Turnada a ${target}.` : `${n} menciones turnadas a ${target}.`;
  if (!whatsapp) return { ok: true, message: base };
  return { ok: true, message: `${base} Se avisará ${whatsapp === 1 ? "al responsable" : "a los responsables"} por WhatsApp.` };
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
});

export async function correctClassification(input: unknown): Promise<InboxActionResult> {
  const m = await member(EDITORS);
  if (!m) return FORBIDDEN;
  const parsed = correctionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const c = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("classifications")
    .update({
      sentiment: c.sentiment,
      topic: c.topic,
      intent: c.intent,
      priority: c.priority,
      department_id: c.departmentId,
      neighborhood_id: c.neighborhoodId,
      // Also set by the trigger; sent so the column is part of the update.
      corrected_by: m.userId,
    })
    .eq("org_id", m.orgId)
    .eq("mention_id", c.mentionId)
    .select("id");
  if (error) return fail(error, "guardar la corrección");
  if (!data?.length) return { ok: false, message: "Esta mención aún no tiene clasificación." };
  return { ok: true, message: "Clasificación corregida." };
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
