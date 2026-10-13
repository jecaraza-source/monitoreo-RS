import { expect, test, type Page } from "@playwright/test";
import { admin, login, toast, USERS } from "./helpers";

// Health of the monitor with five fictitious sources, one per state. Their
// state is written straight into the database, as the ingest worker would.
const ORG = "00000000-0000-4000-a000-000000000001";
const ids = {
  healthy: "00000000-0000-4000-e900-000000000001",
  delayed: "00000000-0000-4000-e900-000000000002",
  failing: "00000000-0000-4000-e900-000000000003",
  paused: "00000000-0000-4000-e900-000000000004",
  partial: "00000000-0000-4000-e900-000000000005",
};
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

async function seed() {
  const db = admin();
  await cleanup();
  const base = { org_id: ORG, type: "rss" as const, is_active: true, consecutive_failures: 0, cursor: {} };
  const { error } = await db.from("sources").insert([
    { ...base, id: ids.healthy, name: "E2E Sana", config: { url: "https://sana.example/feed" }, last_run_at: ago(10), last_success_at: ago(10), covered_until: ago(10) },
    { ...base, id: ids.delayed, name: "E2E Atrasada", config: { url: "https://atrasada.example/feed" }, last_run_at: ago(300), last_success_at: ago(300), covered_until: ago(300) },
    {
      ...base, id: ids.failing, name: "E2E Fallando", config: { url: "https://feed.invalid/rss" }, consecutive_failures: 4,
      last_run_at: ago(30), last_success_at: ago(600), covered_until: ago(600), last_error: "El feed respondió HTTP 404.", last_error_at: ago(30),
    },
    { ...base, id: ids.paused, name: "E2E Pausada", config: { url: "https://pausada.example/feed" }, is_active: false, last_run_at: ago(2000), covered_until: ago(2000) },
    {
      ...base, id: ids.partial, name: "E2E Parcial", config: { url: "https://parcial.example/feed" }, last_run_at: ago(15), last_success_at: ago(15),
      covered_until: ago(90), cursor: { backfill: { since: ago(200), until: ago(120), coverTo: ago(15) } },
    },
  ]);
  if (error) throw new Error(error.message);
  const run = (source: string, over: Record<string, unknown>) => ({
    org_id: ORG, source_id: source, trigger: "cron", status: "ok", started_at: ago(10), fetched: 20, inserted: 3, duplicates: 15, unmatched: 2,
    complete: true, limits: [], error: null, ...over,
  });
  await db.from("ingest_runs").insert([
    run(ids.healthy, {}),
    run(ids.delayed, { started_at: ago(300) }),
    run(ids.failing, { status: "error", started_at: ago(30), fetched: 0, inserted: 0, duplicates: 0, unmatched: 0, complete: null, error: "El feed respondió HTTP 404." }),
    run(ids.partial, { status: "partial", started_at: ago(15), fetched: 1000, inserted: 950, complete: false, limits: [{ kind: "pages", detail: "Publicaciones: se leyeron 10 páginas; el resto se lee en la siguiente corrida." }] }),
  ]);
  // Something new arrived recently from the healthy one.
  await db.from("mentions").insert({ org_id: ORG, source_id: ids.healthy, external_id: "e2e-salud-1", text: "Nota de prueba de salud", published_at: ago(12) });
}

async function cleanup() {
  await admin().from("sources").delete().in("id", Object.values(ids));
}

const card = (page: Page, id: string) => page.locator(`#fuente-${id}`);

test.describe("salud del monitoreo", () => {
  test.beforeAll(seed);
  test.afterAll(cleanup);

  test("comunicación distingue fuente sana, atrasada, fallando, pausada y con cobertura parcial", async ({ page }) => {
    await login(page, USERS.comunicacion, "/salud");
    await expect(page.getByRole("heading", { name: "Salud del monitoreo", level: 1 })).toBeVisible();
    await expect(page.getByText(/Datos al corte: .*\(hora de la Ciudad de México\)/)).toBeVisible();
    await expect(page.getByRole("status")).toContainText("fallando");

    await expect(card(page, ids.healthy)).toContainText("Al día");
    await expect(card(page, ids.healthy)).toContainText("Completa");
    await expect(card(page, ids.delayed)).toContainText("Atrasada");
    await expect(card(page, ids.delayed)).toContainText(/de atraso; el umbral es 3 h/);
    await expect(card(page, ids.failing)).toContainText("Fallando");
    await expect(card(page, ids.failing)).toContainText("El feed respondió HTTP 404.");
    await expect(card(page, ids.failing).getByRole("link", { name: "Revisar la URL del feed" })).toBeVisible();
    await expect(card(page, ids.paused)).toContainText("Pausada");
    await expect(card(page, ids.paused).getByRole("button", { name: "Reintentar ahora" })).toBeDisabled();
    await expect(card(page, ids.partial)).toContainText("Cobertura parcial");
    await expect(card(page, ids.partial)).toContainText("se leyeron 10 páginas");

    // Filtered runs and their detail.
    await page.goto("/salud?estado=error#corridas");
    const runs = page.locator("#corridas li");
    await expect(runs.filter({ hasText: "E2E Fallando" })).toHaveCount(1);
    await expect(runs.filter({ hasText: "E2E Sana" })).toHaveCount(0);
    await runs.filter({ hasText: "E2E Fallando" }).locator("summary").click();
    await expect(runs.filter({ hasText: "E2E Fallando" })).toContainText("Siguiente paso: Revisar la URL del feed");
  });

  test("reintentar lee la fuente una sola vez y respeta la espera", async ({ page }) => {
    const db = admin();
    const count = async () => (await db.from("ingest_runs").select("id", { count: "exact", head: true }).eq("source_id", ids.failing)).count ?? 0;
    const before = await count();
    await login(page, USERS.comunicacion, "/salud");
    const retry = card(page, ids.failing).getByRole("button", { name: "Reintentar ahora" });
    await retry.click();
    await expect(toast(page, "feed.invalid no respondió")).toBeVisible({ timeout: 30_000 });
    await expect.poll(count).toBe(before + 1);

    await retry.click();
    await expect(toast(page, /se leyó hace menos de 60 s/)).toBeVisible();
    expect(await count()).toBe(before + 1);
  });

  test("lectura ve el resumen de frescura, sin detalle ni acciones", async ({ page }) => {
    await login(page, USERS.lectura, "/salud");
    await expect(page.getByRole("heading", { name: "Frescura del dashboard" })).toBeVisible();
    // Scoped to <main>: with Cache Components earlier pages stay in the DOM, hidden (<Activity>).
    await expect(page.getByRole("main").getByText("El detalle por fuente, las corridas y los umbrales los revisan Administración y Comunicación Social.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reintentar ahora" })).toHaveCount(0);
    await expect(page.getByText("HTTP 404")).toHaveCount(0);
  });

  test("dependencia no entra a Salud", async ({ page }) => {
    await login(page, USERS.obras, "/bandeja");
    await page.goto("/salud");
    await expect(page).not.toHaveURL(/\/salud/);
  });
});
