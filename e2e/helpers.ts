import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Locally: `npx supabase status -o env` prints both (API_URL, SECRET_KEY).
const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? "";

export const USERS = {
  admin: "admin@monitoreo.test",
  comunicacion: "comunicacion@monitoreo.test",
  obras: "obras@monitoreo.test",
  lectura: "lectura@monitoreo.test",
} as const;

export function admin() {
  if (!SERVICE_KEY) throw new Error("Falta E2E_SUPABASE_SERVICE_ROLE_KEY (la llave secreta del proyecto Supabase de la app).");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Signs in like the magic link would, without reading email: the admin API
 * mints a one-time token_hash and the app's /auth/confirm exchanges it.
 */
export async function login(page: Page, email: string, next = "/") {
  const { data, error } = await admin().auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) throw new Error(`No se pudo generar el enlace para ${email}: ${error?.message}`);
  await page.goto(`/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=${encodeURIComponent(next)}`);
  await expect(page).not.toHaveURL(/\/login/);
}

/** Toasts from sonner. */
export const toast = (page: Page, text: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: text }).first();
