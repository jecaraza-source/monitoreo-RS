"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type AuthorsResult = { ok: true; message: string } | { ok: false; message: string };

const FORBIDDEN: AuthorsResult = { ok: false, message: "Sólo Administración o Comunicación pueden cambiar el catálogo." };

async function editor() {
  try {
    return await requireRole(["admin", "comunicacion"]);
  } catch {
    return null;
  }
}

function fail(error: { code?: string; message: string }, what: string): AuthorsResult {
  console.error(`[authors] ${what}:`, error.code, error.message);
  if (error.code === "42501") return FORBIDDEN;
  if (["23505", "22023", "P0002"].includes(error.code ?? "")) return { ok: false, message: error.message };
  if (error.code === "23514") return { ok: false, message: "Revisa los datos: algún campo no es válido." };
  return { ok: false, message: `No se pudo ${what}.` };
}

const refresh = () => {
  revalidatePath("/configuracion/autores");
  revalidatePath("/dashboard");
  revalidatePath("/bandeja");
};

const verifySchema = z
  .object({
    platform: z.enum(["rss", "meta", "youtube", "x", "bluesky"]),
    handle: z.string().trim().min(1, "Escribe la cuenta.").max(200),
    kind: z.enum(["media", "public_figure"]),
    display_name: z.string().trim().min(1, "Escribe el nombre público.").max(200),
    evidence: z.string().trim().min(10, "Describe la evidencia (mínimo 10 caracteres).").max(2000),
    evidence_url: z
      .string()
      .trim()
      .max(500)
      .refine((v) => v === "" || /^https:\/\//.test(v), "El enlace de evidencia debe empezar con https://")
      .optional()
      .transform((v) => v || null),
  })
  .transform((v) => ({ ...v, handle: v.platform === "x" || v.platform === "meta" ? v.handle.replace(/^@/, "") : v.platform === "bluesky" ? v.handle.replace(/^@/, "").toLowerCase() : v.handle }))
  .refine((v) => v.platform !== "youtube" || /^UC[\w-]{22}$/.test(v.handle), { message: "El ID de canal empieza con UC y tiene 24 caracteres.", path: ["handle"] });

/** Adds a verified media outlet or public figure. Identity and org come from the session (RPC). */
export async function verifyAuthor(input: unknown): Promise<AuthorsResult> {
  const m = await editor();
  if (!m) return FORBIDDEN;
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("verify_author", {
    p_org_id: m.orgId,
    p_platform: v.platform,
    p_handle: v.handle,
    p_kind: v.kind,
    p_display_name: v.display_name,
    p_evidence: v.evidence,
    p_evidence_url: (v.evidence_url ?? null) as string,
  });
  if (error) return fail(error, "verificar la cuenta");
  refresh();
  return { ok: true, message: "Cuenta verificada. Sus menciones se atribuyen a ella desde ahora." };
}

const revokeSchema = z.object({ id: z.guid("Identificador inválido."), reason: z.string().trim().min(5, "Escribe el motivo.").max(500) });

export async function revokeAuthor(input: unknown): Promise<AuthorsResult> {
  const m = await editor();
  if (!m) return FORBIDDEN;
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_author", { p_entry_id: parsed.data.id, p_reason: parsed.data.reason });
  if (error) return fail(error, "revocar la verificación");
  refresh();
  return { ok: true, message: "Verificación revocada: la cuenta deja de aparecer en rankings y se guarda sólo como seudónimo." };
}
