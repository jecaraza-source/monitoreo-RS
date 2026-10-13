"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { INCIDENT_TYPES } from "@/lib/inbox/model";
import { createClient } from "@/lib/supabase/server";

export type PolicyResult = { ok: true; message: string } | { ok: false; message: string };
const FORBIDDEN: PolicyResult = { ok: false, message: "Sólo un administrador define las políticas de emergencia." };

const types = INCIDENT_TYPES.filter((t) => t !== "none") as [string, ...string[]];
const policySchema = z.object({
  incidentType: z.enum(types),
  channel: z.string().trim().min(2, "Escribe el canal.").max(120),
  instructions: z.string().trim().min(10, "Escribe las instrucciones (al menos 10 caracteres).").max(2000),
});

async function admin() {
  try {
    return await requireRole(["admin"]);
  } catch {
    return null;
  }
}

export async function savePolicy(input: unknown): Promise<PolicyResult> {
  const m = await admin();
  if (!m) return FORBIDDEN;
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("incident_policies").upsert(
    {
      org_id: m.orgId,
      incident_type: parsed.data.incidentType,
      channel: parsed.data.channel,
      instructions: parsed.data.instructions,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,incident_type" },
  );
  if (error) {
    console.error("[emergencies] save:", error.code, error.message);
    return error.code === "42501" ? FORBIDDEN : { ok: false, message: "No se pudo guardar la política." };
  }
  revalidatePath("/configuracion/emergencias");
  return { ok: true, message: "Política guardada." };
}

const deleteSchema = z.object({ incidentType: z.enum(types) });

export async function deletePolicy(input: unknown): Promise<PolicyResult> {
  const m = await admin();
  if (!m) return FORBIDDEN;
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("incident_policies").delete().eq("org_id", m.orgId).eq("incident_type", parsed.data.incidentType);
  if (error) return { ok: false, message: "No se pudo quitar la política." };
  revalidatePath("/configuracion/emergencias");
  return { ok: true, message: "Política quitada." };
}
