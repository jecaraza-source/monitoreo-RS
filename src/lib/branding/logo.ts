import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { detectLogoFormat, type LogoFormat } from "./image";

export const BRANDING_BUCKET = "branding";

export type Logo = { data: Buffer; format: LogoFormat };

/** The org's logo bytes for the PDF, or null (no logo, or it cannot be read: the report still renders). */
export async function loadLogo(client: SupabaseClient<Database>, path: string | null | undefined): Promise<Logo | null> {
  if (!path) return null;
  const { data, error } = await client.storage.from(BRANDING_BUCKET).download(path);
  if (error || !data) {
    console.error("[branding] logo:", error?.message ?? "sin datos");
    return null;
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  const format = detectLogoFormat(bytes);
  return format ? { data: Buffer.from(bytes), format } : null;
}

/** Short-lived link to show the logo in the app (Storage policies check membership). */
export async function logoUrl(client: SupabaseClient<Database>, path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data } = await client.storage.from(BRANDING_BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}
