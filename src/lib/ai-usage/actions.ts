"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PURPOSES } from "./model";

export type AiUsageResult = { ok: true; message: string } | { ok: false; message: string };

const FORBIDDEN: AiUsageResult = { ok: false, message: "Sólo un administrador puede cambiar los límites de IA." };
const PATH = "/configuracion/consumo";

async function admin() {
  try {
    return await requireRole(["admin"]);
  } catch {
    return null;
  }
}

function fail(error: { code?: string; message: string }, what: string): AiUsageResult {
  console.error(`[ai-usage] ${what}:`, error.code, error.message);
  if (error.code === "42501") return FORBIDDEN;
  if (error.code === "23514") return { ok: false, message: "Algún valor está fuera de rango." };
  return { ok: false, message: `No se pudo ${what}.` };
}

const optionalPositive = (max: number, message: string) =>
  z
    .union([z.literal(""), z.null(), z.coerce.number().positive(message).max(max, message)])
    .transform((v) => (v === "" || v === null ? null : v));

const limitsSchema = z.object({
  daily_budget_usd: optionalPositive(100_000, "El presupuesto diario debe ser mayor que cero."),
  monthly_budget_usd: optionalPositive(1_000_000, "El presupuesto mensual debe ser mayor que cero."),
  daily_token_budget: optionalPositive(1e12, "El límite de tokens debe ser mayor que cero.").transform((v) => (v === null ? null : Math.round(v))),
  user_daily_requests: z.coerce.number().int("Usa un número entero.").min(1, "Al menos 1 solicitud.").max(100_000),
  max_concurrent: z.object(
    Object.fromEntries(PURPOSES.map((p) => [p, z.coerce.number().int("Usa enteros.").min(1, "Al menos 1 a la vez.").max(50, "Máximo 50 a la vez.")])) as Record<
      (typeof PURPOSES)[number],
      z.ZodNumber
    >,
  ),
});

/** Saves the org's AI limits. The org and the author come from the session, never from the client. */
export async function saveAiLimits(input: unknown): Promise<AiUsageResult> {
  const m = await admin();
  if (!m) return FORBIDDEN;
  const parsed = limitsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  if (v.daily_budget_usd && v.monthly_budget_usd && v.daily_budget_usd > v.monthly_budget_usd) {
    return { ok: false, message: "El presupuesto diario no puede ser mayor que el mensual." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("ai_limits")
    .upsert({ org_id: m.orgId, ...v, updated_by: m.userId, updated_at: new Date().toISOString() }, { onConflict: "org_id" });
  if (error) return fail(error, "guardar los límites");
  revalidatePath(PATH);
  return { ok: true, message: "Límites guardados. Se aplican desde la siguiente llamada a la IA." };
}

const invoiceSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Elige el mes."),
  amount_usd: z.coerce.number().min(0, "El monto no puede ser negativo.").max(10_000_000),
  reference: z.string().trim().max(120).optional().transform((v) => v || null),
  notes: z.string().trim().max(1000).optional().transform((v) => v || null),
});

/** Records (or corrects) the provider's invoice of a month for the reconciliation. */
export async function saveAiInvoice(input: unknown): Promise<AiUsageResult> {
  const m = await admin();
  if (!m) return FORBIDDEN;
  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("ai_invoices").upsert(
    {
      org_id: m.orgId,
      month: `${parsed.data.month}-01`,
      amount_usd: parsed.data.amount_usd,
      reference: parsed.data.reference,
      notes: parsed.data.notes,
      recorded_by: m.userId,
      recorded_at: new Date().toISOString(),
    },
    { onConflict: "org_id,month" },
  );
  if (error) return fail(error, "guardar la factura");
  revalidatePath(PATH);
  return { ok: true, message: "Factura registrada." };
}

export async function deleteAiInvoice(input: unknown): Promise<AiUsageResult> {
  const m = await admin();
  if (!m) return FORBIDDEN;
  const parsed = z.object({ id: z.guid("Identificador inválido.") }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error, count } = await supabase.from("ai_invoices").delete({ count: "exact" }).eq("id", parsed.data.id).eq("org_id", m.orgId);
  if (error) return fail(error, "borrar la factura");
  if (!count) return { ok: false, message: "No se encontró la factura." };
  revalidatePath(PATH);
  return { ok: true, message: "Factura borrada." };
}
