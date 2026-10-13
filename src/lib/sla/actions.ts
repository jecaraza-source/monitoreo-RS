"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMember, requireRole } from "@/lib/auth/session";
import { PRIORITIES } from "@/lib/inbox/model";
import { createClient } from "@/lib/supabase/server";
import { slaProblem } from "./model";

export type SlaResult = { ok: true; message: string } | { ok: false; message: string };

const FORBIDDEN: SlaResult = { ok: false, message: "Sólo un administrador puede cambiar esta configuración." };
const id = z.guid("Identificador inválido.");
const hours = z.coerce.number().positive("Los plazos deben ser mayores que cero.");
const time = z.string().regex(/^\d{2}:\d{2}$/, "Hora inválida.");

async function admin() {
  try {
    return await requireRole(["admin"]);
  } catch {
    return null;
  }
}

function fail(error: { code?: string; message: string }, what: string): SlaResult {
  console.error(`[sla] ${what}:`, error.code, error.message);
  if (error.code === "42501") return FORBIDDEN;
  if (error.code === "22023" || error.code === "23514") return { ok: false, message: error.message };
  return { ok: false, message: `No se pudo ${what}.` };
}

const refresh = () => {
  revalidatePath("/configuracion/sla");
  revalidatePath("/casos");
  revalidatePath("/configuracion/envios");
};

const configSchema = z.object({
  calendar: z.object({
    mode: z.enum(["calendar", "business"]),
    workdays: z.array(z.number().int().min(1).max(7)).min(1, "Elige al menos un día hábil.").max(7),
    day_start: time,
    day_end: time,
  }),
  holidays: z
    .array(z.object({ day: z.iso.date("Fecha inválida."), name: z.string().trim().min(2, "Nombra el día inhábil.").max(80) }))
    .max(100, "Demasiados días inhábiles."),
  targets: z
    .array(
      z.object({
        category: z.string().trim().max(80).nullable().transform((c) => c || null),
        priority: z.enum(PRIORITIES),
        accept_hours: hours.max(720),
        attention_hours: hours.max(2160),
      }),
    )
    .min(4)
    .max(200),
});

/** Saves calendar, non-working days and targets as a new (reference) version. */
export async function saveSlaConfig(input: unknown): Promise<SlaResult> {
  const m = await admin();
  if (!m) return FORBIDDEN;
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const problem = slaProblem(parsed.data.calendar, parsed.data.targets);
  if (problem) return { ok: false, message: problem };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_sla_config", {
    p_org_id: m.orgId,
    p_calendar: parsed.data.calendar,
    p_holidays: parsed.data.holidays,
    p_targets: parsed.data.targets,
  });
  if (error) return fail(error, "guardar el SLA");
  refresh();
  return { ok: true, message: `Guardado como versión ${(data as { version: number }).version} (valores de referencia hasta aprobarla).` };
}

const approveSchema = z.object({ versionId: id, note: z.string().trim().min(3, "Anota el acuerdo que respalda estos plazos.").max(500) });

export async function approveSlaVersion(input: unknown): Promise<SlaResult> {
  const m = await admin();
  if (!m) return FORBIDDEN;
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_sla_version", { p_version_id: parsed.data.versionId, p_note: parsed.data.note });
  if (error) return fail(error, "aprobar la versión");
  refresh();
  return { ok: true, message: "Versión aprobada como acuerdo operativo." };
}

const settingsSchema = z
  .object({
    reminder_percent: z.coerce.number().int().min(10).max(95),
    link_after_hours: z.coerce.number().min(0).max(720),
    head_after_hours: z.coerce.number().min(0).max(720),
    coordinator_after_hours: z.coerce.number().min(0).max(720),
    quiet_start: z.coerce.number().int().min(0).max(23),
    quiet_end: z.coerce.number().int().min(0).max(23),
    max_per_hour: z.coerce.number().int().min(1).max(100),
    whatsapp_enabled: z.boolean(),
  })
  .refine((s) => s.link_after_hours <= s.head_after_hours && s.head_after_hours <= s.coordinator_after_hours, {
    message: "El orden es enlace, después titular y al final coordinación.",
  });

export async function saveNotificationSettings(input: unknown): Promise<SlaResult> {
  const m = await admin();
  if (!m) return FORBIDDEN;
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notification_settings")
    .update({ ...parsed.data, updated_at: new Date().toISOString(), updated_by: m.userId })
    .eq("org_id", m.orgId)
    .select("org_id");
  if (error) return fail(error, "guardar el escalamiento");
  if (!data?.length) return FORBIDDEN;
  refresh();
  return { ok: true, message: "Escalamiento guardado." };
}

const contactsSchema = z.object({ departmentId: id, linkUserId: id.nullable(), headUserId: id.nullable() });

export async function setDepartmentContacts(input: unknown): Promise<SlaResult> {
  const m = await admin();
  if (!m) return FORBIDDEN;
  const parsed = contactsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_department_contacts", {
    p_department_id: parsed.data.departmentId,
    // null clears the person (the generated types do not model SQL nulls).
    p_link_user_id: parsed.data.linkUserId as string,
    p_head_user_id: parsed.data.headUserId as string,
  });
  if (error) return fail(error, "guardar los contactos");
  refresh();
  revalidatePath("/configuracion/whatsapp");
  return { ok: true, message: "Enlace y titular guardados." };
}

const retrySchema = z.object({ outboxId: id });

export async function retryOutbox(input: unknown): Promise<SlaResult> {
  const m = await admin();
  if (!m) return FORBIDDEN;
  const parsed = retrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("retry_outbox", { p_id: parsed.data.outboxId });
  if (error) return fail(error, "reintentar el envío");
  refresh();
  return { ok: true, message: "Vuelve a la cola: sale en la siguiente corrida (5 min)." };
}

const preferencesSchema = z
  .object({
    email: z.boolean(),
    whatsapp: z.boolean(),
    quiet: z.union([z.null(), z.object({ start: z.coerce.number().int().min(0).max(23), end: z.coerce.number().int().min(0).max(23) })]),
  });

/** The person's own channels and quiet hours. Critical notices ignore both. */
export async function saveMyPreferences(input: unknown): Promise<SlaResult> {
  let m;
  try {
    m = await requireMember();
  } catch {
    return { ok: false, message: "Inicia sesión." };
  }
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("notification_preferences").upsert(
    {
      org_id: m.orgId,
      user_id: m.userId,
      email: v.email,
      whatsapp: v.whatsapp,
      quiet_start: v.quiet?.start ?? null,
      quiet_end: v.quiet?.end ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,user_id" },
  );
  if (error) return fail(error, "guardar tus preferencias");
  revalidatePath("/preferencias");
  return { ok: true, message: "Preferencias guardadas." };
}

const reapplySchema = z.object({
  caseIds: z.array(id).min(1, "Elige al menos un caso.").max(500),
  reason: z.string().trim().min(10, "Explica el motivo (al menos 10 caracteres): queda en el historial de cada caso.").max(500),
  includeOverridden: z.boolean().default(false),
});

/**
 * Applies the current SLA version to the chosen open cases (explicit and
 * audited: case history + audit_log with before/after). Saving a new SLA never
 * changes commitments by itself.
 */
export async function reapplySla(input: unknown): Promise<SlaResult> {
  const m = await admin();
  if (!m) return FORBIDDEN;
  const parsed = reapplySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reapply_sla", {
    p_org_id: m.orgId,
    p_case_ids: parsed.data.caseIds,
    p_reason: parsed.data.reason,
    p_include_overridden: parsed.data.includeOverridden,
  });
  if (error) return fail(error, "reaplicar el SLA");
  refresh();
  const n = data ?? 0;
  return { ok: true, message: n === 1 ? "Se actualizó 1 caso; quedó en su historial." : `Se actualizaron ${n} casos; quedó en su historial.` };
}
