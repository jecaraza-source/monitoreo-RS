"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { PRIORITIES } from "@/lib/inbox/model";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { notifyRoutedTickets } from "@/lib/whatsapp/turns";
import { CASE_STATUSES } from "./model";

export type CaseActionResult<T = undefined> = { ok: true; message: string; data?: T } | { ok: false; message: string };

const FORBIDDEN = { ok: false as const, message: "No tienes permiso para esta acción." };
const id = z.guid("Identificador inválido.");
const ids = z.array(id).min(1, "Elige al menos una mención.").max(500, "Demasiadas menciones a la vez.");
const reason = z.string().trim().max(500, "El motivo es muy largo.");

async function member(roles: readonly ("admin" | "comunicacion" | "dependencia")[]) {
  try {
    return await requireRole(roles);
  } catch {
    return null;
  }
}

/** The database explains rule violations in Spanish (22023, 23505); permission errors stay generic. */
function fail(error: { code?: string; message: string }, what: string): { ok: false; message: string } {
  console.error(`[cases] ${what}:`, error.code, error.message);
  if (error.code === "42501") return FORBIDDEN;
  if (error.code === "22023" || error.code === "23505") return { ok: false, message: error.message };
  return { ok: false, message: `No se pudo ${what}.` };
}

const refresh = (caseId?: string) => {
  revalidatePath("/casos");
  if (caseId) revalidatePath(`/casos/${caseId}`);
  revalidatePath("/bandeja");
};

// ---------------------------------------------------------------------------
// Create, link, edit (admin and comunicación)
// ---------------------------------------------------------------------------

const createSchema = z.object({
  mentionIds: ids,
  title: z.string().trim().min(3, "El título debe tener al menos 3 caracteres.").max(200),
  description: z.string().trim().max(4000).default(""),
  category: z.string().trim().max(80).nullable().default(null),
  neighborhoodId: id.nullable().default(null),
  priority: z.enum(PRIORITIES).default("medium"),
});

export async function createCase(input: unknown): Promise<CaseActionResult<{ id: string }>> {
  const m = await member(["admin", "comunicacion"]);
  if (!m) return FORBIDDEN;
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_case", {
    p_org_id: m.orgId,
    p_mention_ids: v.mentionIds,
    p_title: v.title,
    p_description: v.description,
    p_category: v.category ?? undefined,
    p_neighborhood_id: v.neighborhoodId ?? undefined,
    p_priority: v.priority,
  });
  if (error) return fail(error, "crear el caso");
  refresh(data);
  const n = new Set(v.mentionIds).size;
  return { ok: true, message: `Caso creado con ${n} ${n === 1 ? "mención" : "menciones"}.`, data: { id: data } };
}

const linkSchema = z.object({ caseId: id, mentionIds: ids, reason: reason.default("") });

export async function addMentionsToCase(input: unknown): Promise<CaseActionResult> {
  const m = await member(["admin", "comunicacion"]);
  if (!m) return FORBIDDEN;
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("case_add_mentions", {
    p_case_id: parsed.data.caseId,
    p_mention_ids: parsed.data.mentionIds,
    p_reason: parsed.data.reason || undefined,
  });
  if (error) return fail(error, "agregar las menciones");
  refresh(parsed.data.caseId);
  return { ok: true, message: data === 1 ? "Mención agregada al caso." : `${data} menciones agregadas al caso.` };
}

const unlinkSchema = z.object({ caseId: id, mentionId: id, reason: reason.min(3, "Escribe el motivo.") });

export async function removeMentionFromCase(input: unknown): Promise<CaseActionResult> {
  const m = await member(["admin", "comunicacion"]);
  if (!m) return FORBIDDEN;
  const parsed = unlinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("case_remove_mention", {
    p_case_id: parsed.data.caseId,
    p_mention_id: parsed.data.mentionId,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error, "quitar la mención");
  refresh(parsed.data.caseId);
  return { ok: true, message: "Mención quitada del caso (sigue en la bandeja)." };
}

const updateSchema = z.object({
  caseId: id,
  fields: z
    .object({
      title: z.string().trim().min(3).max(200),
      description: z.string().trim().max(4000),
      category: z.string().trim().max(80).nullable(),
      neighborhood_id: id.nullable(),
      priority: z.enum(PRIORITIES),
      due_at: z.iso.datetime({ offset: true }).nullable(),
      responsible_user_id: id.nullable(),
    })
    .partial(),
});

export async function updateCase(input: unknown): Promise<CaseActionResult> {
  const m = await member(["admin", "comunicacion"]);
  if (!m) return FORBIDDEN;
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_case", { p_case_id: parsed.data.caseId, p_fields: parsed.data.fields });
  if (error) return fail(error, "guardar los cambios");
  refresh(parsed.data.caseId);
  return { ok: true, message: "Caso actualizado." };
}

// ---------------------------------------------------------------------------
// Workflow (editors; the responsible department for its own steps)
// ---------------------------------------------------------------------------

const transitionSchema = z.object({
  caseId: id,
  to: z.enum(CASE_STATUSES).exclude(["merged"]),
  reason: reason.default(""),
  departmentId: id.nullable().default(null),
  supportIds: z.array(id).max(4, "Máximo 4 dependencias de apoyo.").default([]),
  dueAt: z.iso.datetime({ offset: true }).nullable().default(null),
});

export async function transitionCase(input: unknown): Promise<CaseActionResult> {
  const m = await member(["admin", "comunicacion", "dependencia"]);
  if (!m) return FORBIDDEN;
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  if (v.to === "assigned" && v.dueAt && new Date(v.dueAt).getTime() < Date.now() - 60_000) {
    return { ok: false, message: "El plazo ya pasó." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("transition_case", {
    p_case_id: v.caseId,
    p_to: v.to,
    p_reason: v.reason || undefined,
    p_department_id: v.departmentId ?? undefined,
    p_support_ids: v.supportIds,
    p_due_at: v.dueAt ?? undefined,
  });
  if (error) return fail(error, "cambiar el estado del caso");
  const tickets = ((data as { ticket_ids?: string[] } | null)?.ticket_ids ?? []).filter(Boolean);
  if (tickets.length && process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
    // Same WhatsApp notice as routing a mention, after the response.
    after(async () => {
      try {
        await notifyRoutedTickets(createAdminClient(), tickets);
      } catch (e) {
        console.error("[whatsapp] case notice:", e instanceof Error ? e.message : e);
      }
    });
  }
  refresh(v.caseId);
  return { ok: true, message: v.to === "assigned" ? "Caso asignado." : "Estado del caso actualizado." };
}

const noteSchema = z.object({
  caseId: id,
  body: z.string().trim().min(1, "Escribe la nota.").max(2000, "La nota es muy larga."),
  visibility: z.enum(["internal", "department"]),
});

export async function addCaseNote(input: unknown): Promise<CaseActionResult> {
  const m = await member(["admin", "comunicacion", "dependencia"]);
  if (!m) return FORBIDDEN;
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_case_note", {
    p_case_id: parsed.data.caseId,
    p_body: parsed.data.body,
    p_visibility: parsed.data.visibility,
  });
  if (error) return fail(error, "guardar la nota");
  refresh(parsed.data.caseId);
  return { ok: true, message: "Nota agregada." };
}

const mergeSchema = z.object({
  targetId: id,
  sourceIds: z.array(id).min(1, "Elige al menos un caso.").max(20),
  reason: reason.min(3, "Escribe por qué son el mismo caso."),
});

export async function mergeCases(input: unknown): Promise<CaseActionResult> {
  const m = await member(["admin", "comunicacion"]);
  if (!m) return FORBIDDEN;
  const parsed = mergeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("merge_cases", {
    p_target_id: parsed.data.targetId,
    p_source_ids: parsed.data.sourceIds,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error, "fusionar los casos");
  refresh(parsed.data.targetId);
  for (const s of parsed.data.sourceIds) revalidatePath(`/casos/${s}`);
  return { ok: true, message: data === 1 ? "Caso fusionado." : `${data} casos fusionados.` };
}

// ---------------------------------------------------------------------------
// Backfill of existing tickets (admin): dry run first, then apply
// ---------------------------------------------------------------------------

export type BackfillReport = Record<string, unknown>;

export async function simulateTicketBackfill(): Promise<CaseActionResult<BackfillReport>> {
  const m = await member(["admin"]);
  if (!m) return FORBIDDEN;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("simulate_ticket_backfill", { p_org_id: m.orgId });
  if (error) return fail(error, "simular la migración");
  return { ok: true, message: "Simulación lista: no se cambió nada.", data: data as BackfillReport };
}

export async function applyTicketBackfill(): Promise<CaseActionResult<BackfillReport>> {
  const m = await member(["admin"]);
  if (!m) return FORBIDDEN;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("apply_ticket_backfill", { p_org_id: m.orgId });
  if (error) return fail(error, "migrar los turnos");
  refresh();
  const r = data as { cases_created: number; tickets_linked: number };
  return { ok: true, message: `${r.cases_created} casos creados con ${r.tickets_linked} turnos.`, data: data as BackfillReport };
}
