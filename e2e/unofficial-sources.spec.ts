import { expect, test } from "@playwright/test";
import { admin, login, toast, USERS } from "./helpers";

const ORG = "00000000-0000-4000-a000-000000000001";
const NAME = "Apify e2e";

async function cleanUp() {
  await admin().from("sources").delete().eq("org_id", ORG).eq("name", NAME);
}

test.describe("fuentes no oficiales", () => {
  test.beforeEach(cleanUp);
  test.afterEach(cleanUp);

  test("comunicación no puede conectar fuentes no oficiales", async ({ page }) => {
    await login(page, USERS.comunicacion, "/configuracion/fuentes");
    await page.getByRole("button", { name: "Conectar fuente" }).click();
    await page.getByRole("combobox", { name: "Tipo" }).click();
    await expect(page.getByRole("option", { name: "Apify (no oficial)" })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("option", { name: "Puente RSS (no oficial)" })).toHaveAttribute("aria-disabled", "true");
  });

  test("administración conecta una tarea de Apify, marcada como no oficial", async ({ page }) => {
    // Apify is answered by the local mock; a preview would call the real one.
    test.skip(!process.env.APIFY_API_URL || Boolean(process.env.E2E_BASE_URL), "Sólo con el simulador local.");
    await login(page, USERS.admin, "/configuracion/fuentes");
    await page.getByRole("button", { name: "Conectar fuente" }).click();
    await page.getByRole("combobox", { name: "Tipo" }).click();
    await page.getByRole("option", { name: "Apify (no oficial)" }).click();
    await expect(page.getByRole("note")).toContainText("Fuente no oficial");
    await page.getByLabel("Nombre").fill(NAME);
    await page.locator("#source-task").fill("radar/instagram-e2e");
    await page.getByRole("combobox", { name: "Red" }).click();
    await page.getByRole("option", { name: "Instagram" }).click();
    await page.getByText("Guardar sólo lo que coincida con alguna consulta activa").click();
    await page.getByRole("button", { name: "Conectar fuente" }).last().click();
    await expect(toast(page, /Fuente conectada/)).toBeVisible();

    const item = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: NAME }) });
    await expect(item.getByText("No oficial", { exact: true })).toBeVisible();
    await expect(item.getByText("Instagram · tarea radar~instagram-e2e")).toBeVisible();
    await item.getByRole("button", { name: "Probar" }).click();
    await expect(toast(page, /Conexión correcta: 1 elementos/)).toBeVisible();
    await expect(item.getByText(/Apify e2e: fuga de agua/)).toBeVisible();
  });
});
