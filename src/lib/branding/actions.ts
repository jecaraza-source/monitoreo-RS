"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { detectLogoFormat, LOGO_MAX_BYTES, LOGO_MAX_LABEL, logoProblem } from "./image";
import { BRANDING_BUCKET } from "./logo";

export type BrandingResult = { ok: true; message: string } | { ok: false; message: string };

const FORBIDDEN: BrandingResult = { ok: false, message: "Sólo un administrador puede cambiar el logotipo." };
// The declared type only picks the extension; the bytes decide (see confirmLogoUpload).
const prepareSchema = z.object({
  size: z.number().int().positive("Elige una imagen.").max(LOGO_MAX_BYTES, `La imagen pesa más de ${LOGO_MAX_LABEL}.`),
  type: z.enum(["image/png", "image/jpeg"], { message: "Usa una imagen PNG o JPG." }),
});

async function adminMember() {
  try {
    return await requireRole(["admin"]);
  } catch {
    return null;
  }
}

function refresh() {
  revalidatePath("/configuracion/identidad");
  revalidatePath("/reportes");
}

async function currentPath(orgId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("organizations").select("logo_path").eq("id", orgId).single();
  return data?.logo_path ?? null;
}

/**
 * Step 1 of the logo upload (PNG or JPG, up to 5 MB). The file does not pass
 * through the server (Vercel caps request bodies at 4.5 MB): Administración
 * gets a single-use signed URL for a path inside its own org folder and the
 * browser uploads straight to Storage, whose bucket also caps size and type.
 */
export async function prepareLogoUpload(input: { size: number; type: string }): Promise<BrandingResult & { path?: string; token?: string }> {
  const m = await adminMember();
  if (!m) return FORBIDDEN;
  const parsed = prepareSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  // The org comes from the session, never from the browser.
  const path = `${m.orgId}/logo-${Date.now()}.${parsed.data.type === "image/png" ? "png" : "jpg"}`;
  const { data, error } = await createAdminClient().storage.from(BRANDING_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[branding] signed upload:", error?.message);
    return { ok: false, message: "No se pudo preparar la subida." };
  }
  return { ok: true, message: "", path: data.path, token: data.token };
}

/**
 * Step 2: the server reads back what was uploaded and checks it like before
 * (real format by its bytes, dimensions, weight). Only then does it become the
 * logo; anything else is deleted.
 */
const confirmSchema = z.string().max(120).regex(/^[0-9a-f-]{36}\/logo-\d+\.(png|jpg)$/);

export async function confirmLogoUpload(path: string): Promise<BrandingResult> {
  const m = await adminMember();
  if (!m) return FORBIDDEN;
  // Only a path this flow issued, inside the admin's own org folder.
  const parsed = confirmSchema.safeParse(path);
  if (!parsed.success || !parsed.data.startsWith(`${m.orgId}/`)) return { ok: false, message: "Subida inválida." };
  const admin = createAdminClient();
  const { data: file, error: readError } = await admin.storage.from(BRANDING_BUCKET).download(path);
  if (readError || !file) return { ok: false, message: "No se encontró la imagen subida." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = logoProblem(bytes) ?? (detectLogoFormat(bytes) === (path.endsWith(".png") ? "png" : "jpg") ? null : "Usa una imagen PNG o JPG.");
  if (problem) {
    await admin.storage.from(BRANDING_BUCKET).remove([path]);
    return { ok: false, message: problem };
  }

  const previous = await currentPath(m.orgId);
  // With the admin's own permissions (RLS: admins update their org).
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .update({ logo_path: path, logo_updated_at: new Date().toISOString() })
    .eq("id", m.orgId)
    .select("id");
  if (error || !data?.length) {
    console.error("[branding] save:", error?.code, error?.message);
    await admin.storage.from(BRANDING_BUCKET).remove([path]);
    return error?.code === "42501" || !data?.length ? FORBIDDEN : { ok: false, message: "No se pudo guardar el logotipo." };
  }
  if (previous && previous !== path) await admin.storage.from(BRANDING_BUCKET).remove([previous]);
  refresh();
  return { ok: true, message: "Logotipo guardado. Los próximos PDF lo usarán." };
}

export async function removeLogo(): Promise<BrandingResult> {
  const m = await adminMember();
  if (!m) return FORBIDDEN;
  const previous = await currentPath(m.orgId);
  if (!previous) return { ok: true, message: "No había logotipo." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .update({ logo_path: null, logo_updated_at: new Date().toISOString() })
    .eq("id", m.orgId)
    .select("id");
  if (error || !data?.length) return FORBIDDEN;
  await createAdminClient().storage.from(BRANDING_BUCKET).remove([previous]);
  refresh();
  return { ok: true, message: "Logotipo quitado." };
}
