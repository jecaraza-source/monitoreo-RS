"use server";

import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
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

const routeSchema = z.object({
  ids,
  departmentId: id,
  dueAt: z.iso.datetime({ offset: true, message: "Fecha límite inválida." }),
  note: z.string().trim().max(2000).optional(),
});

export async function routeMentions(input: unknown): Promise<InboxActionResult> {
  const m = await member(EDITORS);
  if (!m) return FORBIDDEN;
  const parsed = routeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { ids: mentionIds, departmentId, dueAt, note } = parsed.data;
  if (new Date(dueAt).getTime() < Date.now() - 60_000) return { ok: false, message: "La fecha límite ya pasó." };

  const supabase = await createClient();
  const { data: department } = await supabase
    .from("departments")
    .select("name")
    .eq("org_id", m.orgId)
    .eq("id", departmentId)
    .maybeSingle();
  if (!department) return { ok: false, message: "Dependencia no encontrada." };

  const { data: routed, error } = await supabase.rpc("route_mentions", {
    p_mention_ids: mentionIds,
    p_department_id: departmentId,
    p_due_at: dueAt,
  });
  if (error) return fail(error, "turnar");

  if (note) {
    const { error: noteError } = await supabase
      .from("mention_notes")
      .insert(mentionIds.map((mentionId) => ({ org_id: m.orgId, mention_id: mentionId, body: note })));
    if (noteError) console.error("[inbox] route note:", noteError.code);
  }
  const n = routed ?? mentionIds.length;
  return { ok: true, message: n === 1 ? `Turnada a ${department.name}.` : `${n} menciones turnadas a ${department.name}.` };
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
