"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { narrativeSchema } from "@/lib/ai/narrative";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createReportDraft } from "./data";
import { sendReport, storeReportPdf } from "./deliver";
import { REPORT_KINDS } from "./period";

export type ReportActionResult = { ok: true; message: string; id?: string } | { ok: false; message: string };

const EDITORS = ["admin", "comunicacion"] as const;
const FORBIDDEN: ReportActionResult = { ok: false, message: "No tienes permiso para esta acción." };
const id = z.guid("Identificador inválido.");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");
const recipients = z.array(z.email("Correo inválido.").trim().toLowerCase()).max(30, "Máximo 30 destinatarios.");

async function editor(roles: readonly ("admin" | "comunicacion")[] = EDITORS) {
  try {
    return await requireRole(roles);
  } catch {
    return null;
  }
}

function fail(error: { code?: string; message: string } | null, what: string): ReportActionResult {
  console.error(`[reports] ${what}:`, error?.code, error?.message);
  return error?.code === "42501" ? { ok: false, message: error.message.includes("aprobado") ? error.message : FORBIDDEN.message } : { ok: false, message: `No se pudo ${what}.` };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------------
// Generate, edit, approve, send
// ---------------------------------------------------------------------------

const generateSchema = z.object({ kind: z.enum(REPORT_KINDS), endDay: day.optional(), recipients: recipients.default([]) });

export async function generateReport(input: unknown): Promise<ReportActionResult> {
  const m = await editor();
  if (!m) return FORBIDDEN;
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  try {
    const supabase = await createClient();
    const reportId = await createReportDraft(supabase, { orgId: m.orgId, ...parsed.data });
    revalidatePath("/reportes");
    return { ok: true, message: "Borrador listo. Revísalo y edítalo antes de aprobar.", id: reportId };
  } catch (e) {
    console.error("[reports] generate:", message(e));
    return { ok: false, message: `No se pudo generar el reporte: ${message(e)}` };
  }
}

const saveSchema = z.object({ reportId: id, narrative: narrativeSchema, recipients });

export async function saveReport(input: unknown): Promise<ReportActionResult> {
  const m = await editor();
  if (!m) return FORBIDDEN;
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: `Revisa el texto: ${parsed.error.issues[0].path.join(".")} ${parsed.error.issues[0].message}` };
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("reports")
    .update({ content: parsed.data.narrative as never, recipients: parsed.data.recipients }, { count: "exact" })
    .eq("id", parsed.data.reportId)
    .eq("org_id", m.orgId);
  if (error) return fail(error, "guardar los cambios");
  if (!count) return { ok: false, message: "No se encontró el reporte." };
  revalidatePath(`/reportes/${parsed.data.reportId}`);
  return { ok: true, message: "Cambios guardados." };
}

const approveSchema = z.object({ reportId: id, send: z.boolean().default(true) });

/** Freezes the narrative, renders the PDF to Storage and, if asked, emails it. */
export async function approveReport(input: unknown): Promise<ReportActionResult> {
  const m = await editor();
  if (!m) return FORBIDDEN;
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  // RLS (editors of this org) and the guard trigger (draft → approved, stamps approver).
  const { data, error } = await supabase
    .from("reports")
    .update({ status: "approved" })
    .eq("id", parsed.data.reportId)
    .eq("org_id", m.orgId)
    .eq("status", "draft")
    .select("id, recipients")
    .maybeSingle();
  if (error) return fail(error, "aprobar el reporte");
  if (!data) return { ok: false, message: "El reporte no existe o ya estaba aprobado." };

  try {
    if (parsed.data.send && data.recipients.length) {
      const result = await sendReport(data.id);
      revalidatePath("/reportes");
      revalidatePath(`/reportes/${data.id}`);
      if (result.status === "sent") return { ok: true, message: `Aprobado. PDF enviado a ${result.recipients} destinatario(s).` };
      return { ok: true, message: `Aprobado y PDF guardado, pero el correo no salió: ${result.detail ?? result.status}.` };
    }
    await storeReportPdf(data.id);
  } catch (e) {
    console.error("[reports] approve:", message(e));
    return { ok: false, message: `Se aprobó, pero falló el PDF: ${message(e)}` };
  }
  revalidatePath("/reportes");
  revalidatePath(`/reportes/${data.id}`);
  return { ok: true, message: "Aprobado. El PDF está listo para descargar." };
}

const sendSchema = z.object({ reportId: id });

export async function resendReport(input: unknown): Promise<ReportActionResult> {
  const m = await editor();
  if (!m) return FORBIDDEN;
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data } = await supabase.from("reports").select("id, status").eq("id", parsed.data.reportId).eq("org_id", m.orgId).maybeSingle();
  if (!data) return { ok: false, message: "No se encontró el reporte." };
  if (data.status === "draft") return { ok: false, message: "Aprueba el reporte antes de enviarlo." };
  try {
    const result = await sendReport(data.id);
    revalidatePath(`/reportes/${data.id}`);
    return result.status === "sent"
      ? { ok: true, message: `PDF enviado a ${result.recipients} destinatario(s).` }
      : { ok: false, message: `El correo no salió: ${result.detail ?? result.status}.` };
  } catch (e) {
    return { ok: false, message: message(e) };
  }
}

export async function deleteDraft(input: unknown): Promise<ReportActionResult> {
  const m = await editor();
  if (!m) return FORBIDDEN;
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("reports")
    .delete({ count: "exact" })
    .eq("id", parsed.data.reportId)
    .eq("org_id", m.orgId)
    .eq("status", "draft");
  if (error) return fail(error, "borrar el borrador");
  if (!count) return { ok: false, message: "Sólo se pueden borrar borradores." };
  revalidatePath("/reportes");
  return { ok: true, message: "Borrador eliminado." };
}

// ---------------------------------------------------------------------------
// Schedules and cover colors
// ---------------------------------------------------------------------------

const scheduleSchema = z.object({
  period: z.enum(REPORT_KINDS),
  recipients,
  autoApprove: z.boolean(),
  isActive: z.boolean(),
});

export async function saveSchedule(input: unknown): Promise<ReportActionResult> {
  const m = await editor();
  if (!m) return FORBIDDEN;
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const s = parsed.data;
  if (s.isActive && !s.recipients.length) return { ok: false, message: "Agrega al menos un destinatario." };
  const supabase = await createClient();
  const { error } = await supabase.from("report_schedules").upsert(
    {
      org_id: m.orgId,
      period: s.period,
      recipients: s.recipients,
      auto_approve: s.autoApprove,
      is_active: s.isActive,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,period" },
  );
  if (error) return fail(error, "guardar la programación");
  revalidatePath("/reportes");
  return { ok: true, message: "Programación guardada." };
}

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Usa un color en formato #RRGGBB.");
const brandSchema = z.object({ primary: hex, accent: hex });

export async function saveBrandColors(input: unknown): Promise<ReportActionResult> {
  const m = await editor(["admin"]);
  if (!m) return FORBIDDEN;
  const parsed = brandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ brand_primary: parsed.data.primary.toLowerCase(), brand_accent: parsed.data.accent.toLowerCase() })
    .eq("id", m.orgId);
  if (error) return fail(error, "guardar los colores");
  revalidatePath("/reportes");
  return { ok: true, message: "Colores de portada guardados." };
}
