"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSection } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { CI_KINDS, CI_SEVERITIES, CI_STATUSES, parseIndicators, parseMentionRefs } from "./model";

export type CiResult = { ok: boolean; message: string };

const PATH = "/contrainteligencia";
const FORBIDDEN: CiResult = { ok: false, message: "No tienes permiso para registrar en la Oficina de Contrainteligencia." };

const reportSchema = z.object({
  kind: z.enum(CI_KINDS, "Elige el tipo de reporte."),
  title: z.string().trim().min(3, "Escribe un título (al menos 3 caracteres).").max(160, "El título es muy largo."),
  summary: z.string().trim().max(4000, "El resumen es muy largo."),
  severity: z.enum(CI_SEVERITIES, "Elige la gravedad."),
  indicators: z.array(z.string().max(300, "Cada indicador debe tener hasta 300 caracteres.")).max(30, "Hasta 30 indicadores."),
  mentionIds: z.array(z.guid()).max(50, "Hasta 50 menciones."),
});

const updateSchema = z.object({
  id: z.guid("Reporte inválido."),
  status: z.enum(CI_STATUSES, "Estado inválido."),
  closedNote: z.string().trim().max(2000, "La nota es muy larga."),
});

/** Section, grant and an editing role (lectura only reads); the database re-checks all of it. */
async function editor() {
  const member = await requireSection(PATH);
  return member.role === "admin" || member.role === "comunicacion" ? member : null;
}

function failure(error: { code?: string; message: string }, what: string): CiResult {
  if (error.code === "42501") return FORBIDDEN;
  if (error.code === "22023") return { ok: false, message: error.message };
  console.error(`[contrainteligencia] ${what}:`, error.code);
  return { ok: false, message: `No se pudo ${what}.` };
}

export async function createCiReport(form: FormData): Promise<CiResult> {
  const member = await editor();
  if (!member) return FORBIDDEN;
  const parsed = reportSchema.safeParse({
    kind: form.get("kind"),
    title: form.get("title") ?? "",
    summary: form.get("summary") ?? "",
    severity: form.get("severity") ?? "medium",
    indicators: parseIndicators(String(form.get("indicators") ?? "")),
    mentionIds: parseMentionRefs(String(form.get("mentions") ?? "")),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("ci_reports").insert({
    org_id: member.orgId,
    kind: v.kind,
    title: v.title,
    summary: v.summary,
    severity: v.severity,
    indicators: v.indicators,
    mention_ids: v.mentionIds,
    created_by: member.userId,
  });
  if (error) return failure(error, "registrar el reporte");
  revalidatePath(PATH);
  return { ok: true, message: "Reporte registrado." };
}

export async function updateCiReportStatus(input: unknown): Promise<CiResult> {
  const member = await editor();
  if (!member) return FORBIDDEN;
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  if (v.status === "closed" && v.closedNote.length < 3) return { ok: false, message: "Escribe cómo se cerró (al menos 3 caracteres)." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ci_reports")
    .update({ status: v.status, closed_note: v.status === "closed" ? v.closedNote : null })
    .eq("id", v.id)
    .eq("org_id", member.orgId)
    .select("id");
  if (error) return failure(error, "actualizar el reporte");
  if (!data?.length) return FORBIDDEN;
  revalidatePath(PATH);
  return { ok: true, message: v.status === "closed" ? "Reporte cerrado." : "Estado del reporte actualizado." };
}
