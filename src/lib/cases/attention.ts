"use server";

import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { notifyRoutedTickets } from "@/lib/whatsapp/turns";
import { detectEvidenceFormat, EVIDENCE_MAX_FILES, EVIDENCE_MIME, evidenceProblem, minimizeEvidence, selectionProblem } from "./evidence";

// Stage 6: attention of a case. The database decides who may do what
// (coordination, the lead area, a supporting area); these actions validate
// the input, keep the org from the session and handle the evidence files,
// which are uploaded with the person's own session so Storage RLS applies.

export type AttentionResult = { ok: true; message: string } | { ok: false; message: string };

const FORBIDDEN = { ok: false as const, message: "No tienes permiso para esta acción." };
const BUCKET = "case-evidence";
const id = z.guid("Identificador inválido.");
const date = z.iso.datetime({ offset: true });
const text = (min: number, max: number, message: string) => z.string().trim().min(min, message).max(max, "El texto es muy largo.");

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function member(roles: readonly ("admin" | "comunicacion" | "dependencia")[]) {
  try {
    return await requireRole(roles);
  } catch {
    return null;
  }
}

function fail(error: { code?: string; message: string }, what: string): { ok: false; message: string } {
  console.error(`[cases] ${what}:`, error.code, error.message);
  if (error.code === "42501") return FORBIDDEN;
  if (error.code === "22023" || error.code === "23505") return { ok: false, message: error.message };
  return { ok: false, message: `No se pudo ${what}.` };
}

const refresh = (caseId: string) => {
  revalidatePath("/casos");
  revalidatePath(`/casos/${caseId}`);
  revalidatePath("/bandeja");
};

const files = z.array(z.instanceof(File)).max(EVIDENCE_MAX_FILES, `Máximo ${EVIDENCE_MAX_FILES} archivos por avance.`);
const formFiles = (form: FormData) => form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

/**
 * Checks the files by their bytes, removes photo metadata and uploads them to
 * <org>/<case>/<uuid>.<ext> with the person's session (Storage RLS decides).
 * Returns the paths, to be registered by the database.
 */
async function uploadEvidence(supabase: Supabase, orgId: string, caseId: string, list: File[]): Promise<{ paths: string[] } | { error: string }> {
  const sizeProblem = selectionProblem(list.map((f) => f.size));
  if (sizeProblem) return { error: sizeProblem };
  const ready: { path: string; bytes: Uint8Array; mime: string }[] = [];
  for (const file of list) {
    const raw = new Uint8Array(await file.arrayBuffer());
    const problem = evidenceProblem(raw);
    if (problem) return { error: problem };
    const format = detectEvidenceFormat(raw)!;
    const bytes = minimizeEvidence(raw, format);
    if (!bytes) return { error: "No se pudo leer la imagen; vuelve a exportarla como JPG o PNG." };
    // Random names: the original file name (often a person's name or a date) is not kept.
    ready.push({ path: `${orgId}/${caseId}/${randomUUID()}.${format}`, bytes, mime: EVIDENCE_MIME[format] });
  }
  const paths: string[] = [];
  for (const f of ready) {
    const { error } = await supabase.storage.from(BUCKET).upload(f.path, f.bytes, { contentType: f.mime, upsert: false });
    if (error) {
      console.error("[cases] evidence upload:", error.message);
      await removeUnregistered(supabase, paths);
      return { error: "No se pudo subir la evidencia (revisa que el caso siga en atención y tu permiso)." };
    }
    paths.push(f.path);
  }
  return { paths };
}

/** Files whose registration failed; registered ones cannot be removed (RLS). */
async function removeUnregistered(supabase: Supabase, paths: string[]) {
  if (!paths.length) return;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) console.error("[cases] evidence cleanup:", error.message);
}

// ---------------------------------------------------------------------------
// Assignment (coordination)
// ---------------------------------------------------------------------------

const assignSchema = z.object({
  caseId: id,
  departmentId: id,
  supportIds: z.array(id).max(4, "Máximo 4 dependencias de apoyo.").default([]),
  responsibleUserId: id.nullable().default(null),
  // Null: the SLA computes them (and the case records its version).
  acceptDueAt: date.nullable().default(null),
  dueAt: date.nullable().default(null),
  commitment: z.string().trim().max(1000, "El compromiso es muy largo.").default(""),
  reason: z.string().trim().max(500, "El motivo es muy largo.").default(""),
});

export async function assignCase(input: unknown): Promise<AttentionResult> {
  const m = await member(["admin", "comunicacion"]);
  if (!m) return FORBIDDEN;
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assign_case", {
    p_case_id: v.caseId,
    p_department_id: v.departmentId,
    // The generated types do not model SQL nulls; null means "from the SLA".
    p_due_at: v.dueAt as string,
    p_accept_due_at: v.acceptDueAt as string,
    p_support_ids: v.supportIds,
    p_responsible_user_id: v.responsibleUserId ?? undefined,
    p_commitment: v.commitment || undefined,
    p_reason: v.reason || undefined,
  });
  if (error) return fail(error, "asignar el caso");
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
  return { ok: true, message: "Caso asignado." };
}

// ---------------------------------------------------------------------------
// Progress and evidence (coordination and the areas of the case)
// ---------------------------------------------------------------------------

const updateSchema = z.object({
  caseId: id,
  body: text(3, 2000, "Describe el avance (al menos 3 caracteres)."),
  audience: z.enum(["areas", "coordination"]),
  taskId: id.nullable(),
  files,
});

export async function addCaseUpdate(form: FormData): Promise<AttentionResult> {
  const m = await member(["admin", "comunicacion", "dependencia"]);
  if (!m) return FORBIDDEN;
  const parsed = updateSchema.safeParse({
    caseId: form.get("caseId"),
    body: form.get("body") ?? "",
    audience: form.get("audience") ?? "areas",
    taskId: form.get("taskId") || null,
    files: formFiles(form),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const uploaded = await uploadEvidence(supabase, m.orgId, v.caseId, v.files);
  if ("error" in uploaded) return { ok: false, message: uploaded.error };
  const { error } = await supabase.rpc("add_case_update", {
    p_case_id: v.caseId,
    p_body: v.body,
    p_audience: v.audience,
    p_task_id: v.taskId ?? undefined,
    p_paths: uploaded.paths,
  });
  if (error) {
    await removeUnregistered(supabase, uploaded.paths);
    return fail(error, "guardar el avance");
  }
  refresh(v.caseId);
  const n = uploaded.paths.length;
  return { ok: true, message: n ? `Avance registrado con ${n} ${n === 1 ? "archivo" : "archivos"}.` : "Avance registrado." };
}

// ---------------------------------------------------------------------------
// Validation and reopening (coordination)
// ---------------------------------------------------------------------------

const validateSchema = z.discriminatedUnion("decision", [
  z.object({
    caseId: id,
    decision: z.literal("approved"),
    note: text(3, 2000, "Escribe el resultado de la atención."),
    evidenceSufficient: z.literal(true, { message: "Confirma que la evidencia es suficiente para cerrar." }),
  }),
  z.object({ caseId: id, decision: z.literal("rejected"), note: text(3, 2000, "Escribe el motivo de la devolución.") }),
]);

export async function validateCase(input: unknown): Promise<AttentionResult> {
  const m = await member(["admin", "comunicacion"]);
  if (!m) return FORBIDDEN;
  const parsed = validateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("validate_case", {
    p_case_id: v.caseId,
    p_decision: v.decision,
    p_note: v.note,
    p_evidence_sufficient: v.decision === "approved",
  });
  if (error) return fail(error, "validar el caso");
  refresh(v.caseId);
  return { ok: true, message: v.decision === "approved" ? "Caso validado y cerrado." : "Caso devuelto a atención." };
}

const reopenSchema = z.object({ caseId: id, reason: text(3, 2000, "Escribe por qué el problema persiste."), files });

export async function reopenCase(form: FormData): Promise<AttentionResult> {
  const m = await member(["admin", "comunicacion"]);
  if (!m) return FORBIDDEN;
  const parsed = reopenSchema.safeParse({ caseId: form.get("caseId"), reason: form.get("reason") ?? "", files: formFiles(form) });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const uploaded = await uploadEvidence(supabase, m.orgId, v.caseId, v.files);
  if ("error" in uploaded) return { ok: false, message: uploaded.error };
  const { error } = await supabase.rpc("reopen_case", { p_case_id: v.caseId, p_reason: v.reason, p_paths: uploaded.paths });
  if (error) {
    await removeUnregistered(supabase, uploaded.paths);
    return fail(error, "reabrir el caso");
  }
  refresh(v.caseId);
  return { ok: true, message: "Caso reabierto: empieza un nuevo ciclo." };
}

// ---------------------------------------------------------------------------
// Tasks (coordination and the lead area create; each area works its own)
// ---------------------------------------------------------------------------

const taskSchema = z.object({
  caseId: id,
  departmentId: id,
  title: text(3, 200, "Escribe la tarea."),
  detail: z.string().trim().max(2000).default(""),
  dueAt: date.nullable().default(null),
  responsibleUserId: id.nullable().default(null),
});

export async function addCaseTask(input: unknown): Promise<AttentionResult> {
  const m = await member(["admin", "comunicacion", "dependencia"]);
  if (!m) return FORBIDDEN;
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_case_task", {
    p_case_id: v.caseId,
    p_department_id: v.departmentId,
    p_title: v.title,
    p_detail: v.detail,
    p_due_at: v.dueAt ?? undefined,
    p_responsible_user_id: v.responsibleUserId ?? undefined,
  });
  if (error) return fail(error, "agregar la tarea");
  refresh(v.caseId);
  return { ok: true, message: "Tarea agregada." };
}

const taskStatusSchema = z.object({
  caseId: id,
  taskId: id,
  status: z.enum(["pending", "in_progress", "done", "cancelled"]),
  note: z.string().trim().max(500, "La nota es muy larga.").default(""),
});

export async function updateCaseTask(input: unknown): Promise<AttentionResult> {
  const m = await member(["admin", "comunicacion", "dependencia"]);
  if (!m) return FORBIDDEN;
  const parsed = taskStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_case_task", { p_task_id: v.taskId, p_status: v.status, p_note: v.note || undefined });
  if (error) return fail(error, "actualizar la tarea");
  refresh(v.caseId);
  return { ok: true, message: "Tarea actualizada." };
}
