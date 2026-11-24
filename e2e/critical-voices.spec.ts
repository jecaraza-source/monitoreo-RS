import { expect, test } from "@playwright/test";
import { admin, freshMentions, login, USERS } from "./helpers";

const ORG = "00000000-0000-4000-a000-000000000001";
const MENTION = "00000000-0000-4000-9c00-0000000000e2";
const TEXT = "Voces e2e: sin agua en la colonia Centro por tercera semana";

let fresh: Awaited<ReturnType<typeof freshMentions>> | null = null;

async function cleanUp() {
  await admin().from("mentions").delete().eq("id", MENTION);
  await fresh?.cleanUp();
  fresh = null;
}

test.describe("voces críticas", () => {
  test.beforeEach(async () => {
    await cleanUp();
    const db = admin();
    // A negative mention by a verified outlet: the panel shows what it says, never who said it.
    const { data: source } = await db.from("sources").select("id").eq("org_id", ORG).order("created_at").limit(1).single();
    const { data: author } = await db.from("authors").select("id, display_name").eq("org_id", ORG).eq("kind", "media").not("display_name", "is", null).limit(1).single();
    const { error } = await db.from("mentions").insert({
      id: MENTION,
      org_id: ORG,
      source_id: source!.id,
      external_id: "voces-e2e",
      text: TEXT,
      published_at: new Date(Date.now() - 3600_000).toISOString(),
      metrics: { likes: 900000, shares: 1 },
      status: "classified",
      author_id: author!.id,
    });
    expect(error).toBeNull();
    await db.from("classifications").insert({ org_id: ORG, mention_id: MENTION, sentiment: "negative", emotion: "enojo", topic: "agua potable", priority: "high", model: "e2e" });
    test.info().annotations.push({ type: "author", description: author!.display_name! });
    // Two more complaints that repeat words, so the frequent terms have something to show.
    fresh = await freshMentions("e2e-voces", [{ text: "@vecina_e2e otra vez sin agua en el Centro" }, { text: "Seguimos sin agua, nadie responde" }]);
  });
  test.afterEach(cleanUp);

  test("comunicación ve qué se critica, sin autores, y llega desde el dashboard", async ({ page }) => {
    const authorName = test.info().annotations.find((a) => a.type === "author")!.description!;
    await login(page, USERS.comunicacion, "/dashboard?periodo=24h");
    await page.getByRole("link", { name: "Voces críticas" }).click();
    await expect(page).toHaveURL(/\/dashboard\/voces-criticas\?periodo=24h/);
    await expect(page.getByRole("heading", { name: "Voces críticas", level: 1 })).toBeVisible();
    await expect(page.getByText("Sin identidades.", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Menciones negativas" })).toBeVisible();

    const top = page.getByRole("list", { name: "Críticas con más alcance" });
    await expect(top.getByText(TEXT)).toBeVisible();
    // The dashboard lists the outlet next to this mention; here only the text shows.
    await expect(top).not.toContainText(authorName);
    const terms = page.getByRole("list", { name: "Términos frecuentes" });
    await expect(terms).toBeVisible();
    await expect(terms).not.toContainText("@");
  });

  test("una dependencia no entra a Voces críticas", async ({ page }) => {
    await login(page, USERS.agua, "/dashboard/voces-criticas");
    await expect(page).not.toHaveURL(/voces-criticas/);
  });
});

test("una consulta parte de un tema y Fuentes la ofrece como búsqueda de X", async ({ page }) => {
  await login(page, USERS.comunicacion, "/configuracion/proyectos/00000000-0000-4000-e000-000000000001?consulta=nueva");
  await page.getByRole("combobox", { name: "Partir de un tema (opcional)" }).click();
  await page.getByRole("option", { name: "Agua y drenaje" }).click();
  await expect(page.getByLabel("Nombre de la consulta")).toHaveValue("Agua y drenaje");
  await expect(page.locator("pre[aria-live]")).toContainText('"sin agua"');

  await page.goto("/configuracion/fuentes");
  await expect(page.getByRole("heading", { name: "Búsquedas por tema para X (Apify)" })).toBeVisible();
  // Scoped to the visible copy: React streaming can briefly leave a hidden one.
  await expect(page.locator("pre:visible", { hasText: '"searchTerms"' })).toBeVisible();
});
