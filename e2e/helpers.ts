import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Locally: `npx supabase status -o env` prints both (API_URL, SECRET_KEY).
const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? "";

export const USERS = {
  admin: "admin@monitoreo.test",
  comunicacion: "comunicacion@monitoreo.test",
  obras: "obras@monitoreo.test",
  agua: "agua@monitoreo.test",
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
  // On a preview the one-time token is occasionally gone by the time the app
  // verifies it (Auth answers "One-time token not found"): a fresh link, once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await admin().auth.admin.generateLink({ type: "magiclink", email });
    if (error || !data.properties?.hashed_token) throw new Error(`No se pudo generar el enlace para ${email}: ${error?.message}`);
    await page.goto(`/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=${encodeURIComponent(next)}`);
    if (attempt === 0 && /\/login\?error=link/.test(page.url())) continue;
    break;
  }
  await expect(page).not.toHaveURL(/\/login/);
}

/** Toasts from sonner. */
export const toast = (page: Page, text: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: text }).first();

/** The second, fictitious municipality of the seed (local only; preview has one org). */
export const ORG_B = "00000000-0000-4000-a000-00000000000b";
export const USERS_B = { admin: "admin@municipio-b.test", comunicacion: "comunicacion@municipio-b.test" } as const;

// Publishable (anon) key of the project: what a browser holds. Locally the app's own key.
const PUBLISHABLE_KEY = process.env.E2E_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export const canCallApiDirectly = () => Boolean(SERVICE_KEY && PUBLISHABLE_KEY);

/** An anonymous client with only the publishable key (no session). */
export function anonApi() {
  return createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * A Supabase client signed in as `email` through the magic-link token flow
 * (the same token the email carries), to call PostgREST, RPCs and Storage
 * directly — what anyone with a session could do outside the app's menus.
 */
export async function apiAs(email: string) {
  const { data, error } = await admin().auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) throw new Error(`No se pudo generar el enlace para ${email}: ${error?.message}`);
  const client = anonApi();
  const { error: verifyError } = await client.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
  if (verifyError) throw new Error(`No se pudo iniciar sesión como ${email}: ${verifyError.message}`);
  return client;
}

export type FreshMention = {
  text: string;
  sentiment?: "positive" | "neutral" | "negative";
  topic?: string;
  /** In the first colonia of the catalog (map layers). */
  located?: boolean;
  /** Attributed to an unverified account (shown as «Ciudadano»). */
  citizen?: boolean;
  hoursAgo?: number;
};

/**
 * Classified mentions published in the last hours, so a test does not depend on
 * how old the environment's demo data is (a preview seeded weeks ago has
 * nothing in "the last 30 days"). Refreshes the rollup the charts read.
 */
export async function freshMentions(tag: string, items: FreshMention[]) {
  const db = admin();
  const [{ data: source }, { data: place }, { data: citizen }] = await Promise.all([
    db.from("sources").select("id").eq("org_id", ORG_A).order("created_at").limit(1).single(),
    db.from("neighborhoods").select("id, name").eq("org_id", ORG_A).order("name").limit(1).single(),
    db.from("authors").select("id").eq("org_id", ORG_A).not("pseudonymized_at", "is", null).limit(1).maybeSingle(),
  ]);
  if (!source) throw new Error("El municipio de prueba no tiene fuentes.");
  const stamp = Date.now();
  const rows = items.map((item, i) => ({
    org_id: ORG_A,
    source_id: source.id,
    external_id: `${tag}-${stamp}-${i}`,
    text: item.text,
    published_at: new Date(stamp - (item.hoursAgo ?? 1) * 3600_000 - i * 60_000).toISOString(),
    metrics: { likes: 3 },
    status: "classified" as const,
    author_id: item.citizen ? (citizen?.id ?? null) : null,
  }));
  const { data: inserted, error } = await db.from("mentions").insert(rows).select("id");
  if (error || !inserted) throw new Error(`No se pudieron crear las menciones de prueba: ${error?.message}`);
  const ids = inserted.map((m) => m.id);
  const { error: classError } = await db.from("classifications").insert(
    items.map((item, i) => ({
      org_id: ORG_A,
      mention_id: ids[i],
      sentiment: item.sentiment ?? "negative",
      topic: item.topic ?? "agua potable",
      priority: "medium" as const,
      neighborhood_id: item.located ? (place?.id ?? null) : null,
      model: "e2e",
    })),
  );
  if (classError) throw new Error(`No se pudieron clasificar las menciones de prueba: ${classError.message}`);
  await db.rpc("refresh_mention_stats");
  return {
    ids,
    neighborhood: place,
    async cleanUp() {
      await db.from("mentions").delete().in("id", ids);
      await db.rpc("refresh_mention_stats");
    },
  };
}

const ORG_A = "00000000-0000-4000-a000-000000000001";
