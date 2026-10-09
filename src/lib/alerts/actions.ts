"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { channelsSchema, CONDITION_SCHEMAS, defaultRules, RULE_KINDS } from "./rules";

export type AlertActionResult = { ok: true; message: string } | { ok: false; message: string };

const EDITORS = ["admin", "comunicacion"] as const;
const RATERS = ["admin", "comunicacion", "dependencia"] as const;
const FORBIDDEN: AlertActionResult = { ok: false, message: "No tienes permiso para esta acción." };
const PATH = "/alertas";
const id = z.guid("Identificador inválido.");

async function member(roles: readonly ("admin" | "comunicacion" | "dependencia" | "lectura")[]) {
  try {
    return await requireRole(roles);
  } catch {
    return null;
  }
}

function fail(error: { code?: string; message: string } | null, what: string): AlertActionResult {
  console.error(`[alerts] ${what}:`, error?.code, error?.message);
  return error?.code === "42501" ? FORBIDDEN : { ok: false, message: `No se pudo ${what}.` };
}

// ---------------------------------------------------------------------------
// Rules (admin, comunicación)
// ---------------------------------------------------------------------------

const ruleSchema = z
  .object({
    id: id.nullable(),
    name: z.string().trim().min(3, "Ponle nombre a la regla.").max(120),
    kind: z.enum(RULE_KINDS),
    condition: z.record(z.string(), z.unknown()),
    channels: channelsSchema,
    departmentId: id.nullable(),
    cooldownMinutes: z.coerce.number().int().min(5, "Mínimo 5 minutos.").max(10080, "Máximo 7 días."),
    isActive: z.boolean(),
  })
  .superRefine((rule, ctx) => {
    const parsed = CONDITION_SCHEMAS[rule.kind].safeParse(rule.condition);
    if (!parsed.success) ctx.addIssue({ code: "custom", message: `Parámetros inválidos: ${parsed.error.issues[0].message}` });
  });

export async function saveRule(input: unknown): Promise<AlertActionResult> {
  const m = await member(EDITORS);
  if (!m) return FORBIDDEN;
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const r = parsed.data;
  const row = {
    name: r.name,
    kind: r.kind,
    condition: CONDITION_SCHEMAS[r.kind].parse(r.condition) as never,
    channels: r.channels as never,
    department_id: r.departmentId,
    cooldown_minutes: r.cooldownMinutes,
    is_active: r.isActive,
    updated_at: new Date().toISOString(),
  };
  const supabase = await createClient();
  const { error } = r.id
    ? await supabase.from("alert_rules").update(row).eq("org_id", m.orgId).eq("id", r.id)
    : await supabase.from("alert_rules").insert({ ...row, org_id: m.orgId });
  if (error) return fail(error, "guardar la regla");
  revalidatePath(PATH);
  return { ok: true, message: r.id ? "Regla actualizada." : "Regla creada." };
}

export async function setRuleActive(ruleId: string, active: boolean): Promise<AlertActionResult> {
  const m = await member(EDITORS);
  if (!m) return FORBIDDEN;
  if (!id.safeParse(ruleId).success) return { ok: false, message: "Regla inválida." };
  const supabase = await createClient();
  const { error } = await supabase.from("alert_rules").update({ is_active: active }).eq("org_id", m.orgId).eq("id", ruleId);
  if (error) return fail(error, "cambiar la regla");
  revalidatePath(PATH);
  return { ok: true, message: active ? "Regla activada." : "Regla pausada." };
}

export async function deleteRule(ruleId: string): Promise<AlertActionResult> {
  const m = await member(EDITORS);
  if (!m) return FORBIDDEN;
  if (!id.safeParse(ruleId).success) return { ok: false, message: "Regla inválida." };
  const supabase = await createClient();
  const { error } = await supabase.from("alert_rules").delete().eq("org_id", m.orgId).eq("id", ruleId);
  if (error) return fail(error, "eliminar la regla");
  revalidatePath(PATH);
  return { ok: true, message: "Regla eliminada junto con sus alertas." };
}

/** One rule of each kind with sensible defaults, notifying the current user by email. */
export async function createDefaultRules(): Promise<AlertActionResult> {
  const m = await member(EDITORS);
  if (!m) return FORBIDDEN;
  const supabase = await createClient();
  const { error } = await supabase.from("alert_rules").insert(
    defaultRules().map((r) => ({
      org_id: m.orgId,
      name: r.name,
      kind: r.kind,
      condition: r.condition as never,
      channels: { email: m.email ? [m.email] : [], whatsapp: [] },
      cooldown_minutes: r.cooldown,
    })),
  );
  if (error) return fail(error, "crear las reglas");
  revalidatePath(PATH);
  return { ok: true, message: "Se crearon 5 reglas sugeridas. Ajusta destinatarios y umbrales." };
}

// ---------------------------------------------------------------------------
// Alerts (rating and "seen"); RLS limits departments to their own alerts
// ---------------------------------------------------------------------------

const rateSchema = z.object({ eventId: id, feedback: z.enum(["useful", "false_alarm"]).nullable() });

export async function rateAlert(input: unknown): Promise<AlertActionResult> {
  const m = await member(RATERS);
  if (!m) return FORBIDDEN;
  const parsed = rateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("alert_events")
    .update({ feedback: parsed.data.feedback })
    .eq("org_id", m.orgId)
    .eq("id", parsed.data.eventId)
    .select("id");
  if (error) return fail(error, "guardar tu calificación");
  if (!data?.length) return FORBIDDEN;
  return {
    ok: true,
    message: parsed.data.feedback === "useful" ? "Marcada como útil." : parsed.data.feedback ? "Marcada como falsa alarma." : "Calificación quitada.",
  };
}

export async function acknowledgeAlerts(eventIds: string[]): Promise<AlertActionResult> {
  const m = await member(["admin", "comunicacion", "dependencia", "lectura"]);
  if (!m) return FORBIDDEN;
  const ids = z.array(id).max(500).safeParse(eventIds);
  if (!ids.success || ids.data.length === 0) return { ok: true, message: "" };
  // lectura has no update policy: the update matches nothing, which is fine.
  const supabase = await createClient();
  await supabase
    .from("alert_events")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("org_id", m.orgId)
    .in("id", ids.data)
    .is("acknowledged_at", null);
  return { ok: true, message: "" };
}

// ---------------------------------------------------------------------------
// Crisis log (admin, comunicación)
// ---------------------------------------------------------------------------

const logSchema = z.object({
  body: z.string().trim().min(1, "Escribe la acción.").max(2000, "Es muy largo."),
  alertEventId: id.nullable().optional(),
});

export type CrisisEntry = { id: string; author_name: string; body: string; created_at: string };

export async function addCrisisEntry(input: unknown): Promise<AlertActionResult & { entry?: CrisisEntry }> {
  const m = await member(EDITORS);
  if (!m) return FORBIDDEN;
  const parsed = logSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crisis_log")
    .insert({ org_id: m.orgId, body: parsed.data.body, alert_event_id: parsed.data.alertEventId ?? null })
    .select("id, author_name, body, created_at")
    .single();
  if (error) return fail(error, "registrar la acción");
  return { ok: true, message: "Acción registrada.", entry: data };
}
