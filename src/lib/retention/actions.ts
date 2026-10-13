"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type RetentionResult = { ok: true; message: string } | { ok: false; message: string };
const FORBIDDEN: RetentionResult = { ok: false, message: "Sólo un administrador puede cambiar la retención." };
const PATH = "/configuracion/retencion";

async function admin() {
  try {
    return await requireRole(["admin"]);
  } catch {
    return null;
  }
}

function fail(error: { code?: string; message: string }, what: string): RetentionResult {
  console.error(`[retention] ${what}:`, error.code, error.message);
  if (error.code === "42501") return { ok: false, message: error.message.includes("Conservación") || error.message.includes("conservación") ? error.message : FORBIDDEN.message };
  if (error.code === "23514") return { ok: false, message: "Con plazo de eliminación, registra la referencia y la fecha del acuerdo del municipio." };
  return { ok: false, message: `No se pudo ${what}.` };
}

const day = z.iso.date("Fecha inválida.");

const policySchema = z
  .object({
    mentionMonths: z.union([z.literal(""), z.null(), z.coerce.number().int("Usa meses enteros.").min(1).max(240)]).transform((v) => (v === "" || v === null ? null : v)),
    agreementReference: z.string().trim().max(200).default(""),
    agreementDate: z.union([z.literal(""), day]).default(""),
    notes: z.string().trim().max(1000).default(""),
    paused: z.boolean().default(false),
  })
  .refine((p) => p.mentionMonths === null || (p.agreementReference.length >= 3 && p.agreementDate), {
    message: "Con plazo de eliminación, registra la referencia y la fecha del acuerdo del municipio.",
  });

/**
 * The municipality's retention policy. The app does not assume a legal term:
 * the plazo comes from a municipal agreement, recorded with its reference.
 * Mentions in cases and under conservation holds are never deleted.
 */
export async function saveRetentionPolicy(input: unknown): Promise<RetentionResult> {
  const m = await admin();
  if (!m) return FORBIDDEN;
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("retention_policies").upsert({
    org_id: m.orgId,
    mention_months: v.mentionMonths,
    agreement_reference: v.agreementReference || null,
    agreement_date: v.agreementDate || null,
    notes: v.notes,
    paused: v.paused,
    updated_by: m.userId,
    updated_at: new Date().toISOString(),
  });
  if (error) return fail(error, "guardar la política");
  revalidatePath(PATH);
  revalidatePath("/configuracion/municipio");
  return { ok: true, message: v.mentionMonths ? "Política guardada. Se aplica en la siguiente depuración diaria." : "Política guardada: sin eliminación automática." };
}

const holdSchema = z
  .object({
    coversFrom: z.union([z.literal(""), day]).default(""),
    coversTo: z.union([z.literal(""), day]).default(""),
    reason: z.string().trim().min(10, "Explica la obligación de conservar (al menos 10 caracteres).").max(500),
    reference: z.string().trim().max(200).default(""),
  })
  .refine((h) => !h.coversFrom || !h.coversTo || h.coversFrom <= h.coversTo, { message: "La fecha inicial es posterior a la final." });

/** A conservation hold: blocks the deletion of what it covers until released. */
export async function createRetentionHold(input: unknown): Promise<RetentionResult> {
  const m = await admin();
  if (!m) return FORBIDDEN;
  const parsed = holdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("retention_holds").insert({
    org_id: m.orgId,
    covers_from: v.coversFrom || null,
    covers_to: v.coversTo || null,
    reason: v.reason,
    reference: v.reference || null,
    created_by: m.userId,
  });
  if (error) return fail(error, "crear la conservación");
  revalidatePath(PATH);
  return { ok: true, message: "Conservación registrada: lo que cubre no se eliminará." };
}

const releaseSchema = z.object({ id: z.guid("Identificador inválido."), reason: z.string().trim().min(5, "Escribe el motivo de la liberación.").max(500) });

export async function releaseRetentionHold(input: unknown): Promise<RetentionResult> {
  const m = await admin();
  if (!m) return FORBIDDEN;
  const parsed = releaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("retention_holds")
    .update({ released_at: new Date().toISOString(), released_by: m.userId, release_reason: parsed.data.reason }, { count: "exact" })
    .eq("id", parsed.data.id)
    .eq("org_id", m.orgId);
  if (error) return fail(error, "liberar la conservación");
  if (!count) return { ok: false, message: "No se encontró la conservación." };
  revalidatePath(PATH);
  return { ok: true, message: "Conservación liberada; queda en el historial." };
}
