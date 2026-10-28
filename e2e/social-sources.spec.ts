import { expect, test } from "@playwright/test";
import { admin, login, toast, USERS } from "./helpers";

const ORG = "00000000-0000-4000-a000-000000000001";
const NAMES = ["Bluesky e2e", "Reddit e2e"];

async function cleanUp() {
  await admin().from("sources").delete().eq("org_id", ORG).in("name", NAMES);
}

test.describe("fuentes Bluesky y Reddit", () => {
  // The platforms are answered by the local mock; a preview would call the real ones.
  test.skip(!process.env.BLUESKY_SERVICE || Boolean(process.env.E2E_BASE_URL), "Sólo con el simulador local.");
  test.beforeEach(cleanUp);
  test.afterEach(cleanUp);

  for (const [type, name, field, value, expected] of [
    ["Bluesky", "Bluesky e2e", "#source-query", "Alvarado", /Bluesky e2e: Alvarado sin agua/],
    ["Reddit", "Reddit e2e", "#source-subreddit", "veracruz", /Reddit e2e: nuevo baches en Alvarado/],
  ] as const) {
    test(`comunicación conecta ${type} y la prueba trae publicaciones`, async ({ page }) => {
      await login(page, USERS.comunicacion, "/configuracion/fuentes");
      await page.getByRole("button", { name: "Conectar fuente" }).click();
      await page.getByRole("combobox", { name: "Tipo" }).click();
      await page.getByRole("option", { name: type }).click();
      await page.getByLabel("Nombre").fill(name);
      await page.locator(field).fill(value);
      // The test should show what the platform returns, whatever the active queries.
      await page.getByText("Guardar sólo lo que coincida con alguna consulta activa").click();
      await page.getByRole("button", { name: "Conectar fuente" }).last().click();
      await expect(toast(page, /Fuente/)).toBeVisible();

      const item = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name }) });
      await expect(item.getByText(type, { exact: true })).toBeVisible();
      await item.getByRole("button", { name: "Probar" }).click();
      await expect(toast(page, /Conexión correcta: 1 elementos/)).toBeVisible();
      await expect(item.getByText(expected)).toBeVisible();
    });
  }
});
