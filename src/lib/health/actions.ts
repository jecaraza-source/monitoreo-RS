"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type HealthActionResult = { ok: true; message: string } | { ok: false; message: string };

const FORBIDDEN: HealthActionResult = { ok: false, message: "No tienes permiso para cambiar los umbrales." };

async function editor() {
  try {
    return await requireRole(["admin", "comunicacion"]);
  } catch {
    return null;
  }
}

const minutes = (min: number, max: number, what: string) =>
  z.coerce.number({ message: `${what}: escribe un número.` }).int(`${what}: sin decimales.`).min(min, `${what}: mínimo ${min}.`).max(max, `${what}: máximo ${max}.`);

const sourceSchema = z
  .object({
    sourceId: z.guid("Fuente inválida."),
    expectedEveryMinutes: minutes(15, 10080, "Frecuencia"),
    staleAfterMinutes: minutes(15, 43200, "Atraso").nullable(),
    quietAfterHours: minutes(1, 2160, "Sin publicaciones"),
  })
  .refine((v) => v.staleAfterMinutes === null || v.staleAfterMinutes >= v.expectedEveryMinutes, {
    message: "El atraso debe ser al menos la frecuencia esperada.",
  });

/** Frequency and thresholds of one source (editors of its org; RLS and column grants enforce it too). */
export async function saveSourceThresholds(input: unknown): Promise<HealthActionResult> {
  const m = await editor();
  if (!m) return FORBIDDEN;
  const parsed = sourceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sources")
    .update({ expected_every_minutes: v.expectedEveryMinutes, stale_after_minutes: v.staleAfterMinutes, quiet_after_hours: v.quietAfterHours })
    .eq("id", v.sourceId)
    .eq("org_id", m.orgId)
    .select("id");
  if (error) {
    console.error("[health] thresholds:", error.code, error.message);
    return error.code === "42501" ? FORBIDDEN : { ok: false, message: "No se pudieron guardar los umbrales." };
  }
  if (!data?.length) return { ok: false, message: "Fuente no encontrada." };
  revalidatePath("/salud");
  return { ok: true, message: "Umbrales de la fuente guardados." };
}

const settingsSchema = z.object({
  classifyBacklogMinutes: minutes(5, 1440, "Rezago"),
  classifyStaleMinutes: minutes(5, 1440, "Clasificador detenido"),
  dashboardStaleMinutes: minutes(5, 1440, "Dashboard"),
});

/** Classifier and dashboard thresholds of the org. */
export async function saveMonitorSettings(input: unknown): Promise<HealthActionResult> {
  const m = await editor();
  if (!m) return FORBIDDEN;
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const values = {
    classify_backlog_minutes: v.classifyBacklogMinutes,
    classify_stale_minutes: v.classifyStaleMinutes,
    dashboard_stale_minutes: v.dashboardStaleMinutes,
  };
  // Update first (column grants do not cover org_id), insert the first time.
  const updated = await supabase.from("monitor_settings").update(values).eq("org_id", m.orgId).select("org_id");
  const { error } =
    updated.error || updated.data?.length ? updated : await supabase.from("monitor_settings").insert({ org_id: m.orgId, ...values });
  if (error) {
    console.error("[health] settings:", error.code, error.message);
    return error.code === "42501" ? FORBIDDEN : { ok: false, message: "No se pudieron guardar los umbrales." };
  }
  revalidatePath("/salud");
  return { ok: true, message: "Umbrales guardados." };
}
