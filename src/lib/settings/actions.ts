"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { MANUAL_CHECKS } from "./onboarding";

export type SettingsResult = { ok: true; message: string } | { ok: false; message: string };
const FORBIDDEN: SettingsResult = { ok: false, message: "Sólo un administrador puede registrar la puesta en operación." };

async function admin() {
  try {
    return await requireRole(["admin"]);
  } catch {
    return null;
  }
}

const keys = MANUAL_CHECKS.map((m) => m.key) as [string, ...string[]];
const checkSchema = z.object({ key: z.enum(keys), note: z.string().trim().min(5, "Anota qué se probó y con qué resultado.").max(500) });

/** Records a manual start-of-operation check (who and when come from the session; audited). */
export async function recordOnboardingCheck(input: unknown): Promise<SettingsResult> {
  const m = await admin();
  if (!m) return FORBIDDEN;
  const parsed = checkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase
    .from("onboarding_checks")
    .upsert({ org_id: m.orgId, key: parsed.data.key, note: parsed.data.note, done_by: m.userId, done_at: new Date().toISOString() });
  if (error) {
    console.error("[onboarding]", error.code, error.message);
    return error.code === "42501" ? FORBIDDEN : { ok: false, message: "No se pudo registrar." };
  }
  revalidatePath("/configuracion/municipio");
  return { ok: true, message: "Registrado en la lista de puesta en operación." };
}

export async function clearOnboardingCheck(input: unknown): Promise<SettingsResult> {
  const m = await admin();
  if (!m) return FORBIDDEN;
  const parsed = z.object({ key: z.enum(keys) }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Elemento inválido." };
  const supabase = await createClient();
  const { error } = await supabase.from("onboarding_checks").delete().eq("org_id", m.orgId).eq("key", parsed.data.key);
  if (error) return { ok: false, message: "No se pudo quitar." };
  revalidatePath("/configuracion/municipio");
  return { ok: true, message: "Quitado de la lista." };
}
