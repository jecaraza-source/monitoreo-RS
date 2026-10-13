"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { detectLogoFormat, logoProblem } from "./image";
import { BRANDING_BUCKET } from "./logo";

export type BrandingResult = { ok: true; message: string } | { ok: false; message: string };

const FORBIDDEN: BrandingResult = { ok: false, message: "Sólo un administrador puede cambiar el logotipo." };
const CONTENT_TYPE = { png: "image/png", jpg: "image/jpeg" } as const;
// The declared type and name are ignored: the bytes decide (see logoProblem).
const uploadSchema = z.object({ logo: z.instanceof(File, { message: "Elige una imagen." }) });

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

/** Uploads the client's logo (PNG or JPG, up to 1 MB) and uses it in the reports. */
export async function uploadLogo(formData: FormData): Promise<BrandingResult> {
  const m = await adminMember();
  if (!m) return FORBIDDEN;
  const parsed = uploadSchema.safeParse({ logo: formData.get("logo") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const bytes = new Uint8Array(await parsed.data.logo.arrayBuffer());
  const problem = logoProblem(bytes);
  if (problem) return { ok: false, message: problem };
  const format = detectLogoFormat(bytes)!;

  // The org comes from the session, never from the form.
  const path = `${m.orgId}/logo-${Date.now()}.${format}`;
  const previous = await currentPath(m.orgId);
  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage.from(BRANDING_BUCKET).upload(path, bytes, { contentType: CONTENT_TYPE[format], upsert: false });
  if (uploadError) {
    console.error("[branding] upload:", uploadError.message);
    return { ok: false, message: "No se pudo subir la imagen." };
  }
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
