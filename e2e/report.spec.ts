import { expect, test } from "@playwright/test";
import { solidPng } from "./fixtures-png";
import { admin, login, toast, USERS } from "./helpers";

const ORG = "00000000-0000-4000-a000-000000000001";

test.describe("reportes", () => {
  test.setTimeout(180_000);

  test("el reporte semanal se genera, se edita, se aprueba y se descarga en PDF con el logotipo del cliente", async ({ page, browser }) => {
    // Admin uploads the client's logo in Configuración → Identidad.
    const settings = await browser.newPage();
    await login(settings, USERS.admin, "/configuracion/identidad");
    // Scoped to <main>: earlier pages stay in the DOM, hidden by <Activity>.
    await settings.getByRole("main").locator("#logo-file").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: solidPng(240, 80, [3, 42, 80]) });
    await expect(toast(settings, "Logotipo guardado")).toBeVisible();
    await expect(settings.getByRole("img", { name: "Logotipo del cliente" }).first()).toBeVisible();
    await settings.close();

    try {
      await generateApproveAndDownload(page);
    } finally {
      // Leave the org as found (the suite also runs against the preview database).
      const db = admin();
      const { data } = await db.from("organizations").select("logo_path").eq("id", ORG).single();
      if (data?.logo_path) {
        await db.storage.from("branding").remove([data.logo_path]);
        await db.from("organizations").update({ logo_path: null }).eq("id", ORG);
      }
    }
  });
});

async function generateApproveAndDownload(page: import("@playwright/test").Page) {
  await login(page, USERS.comunicacion, "/reportes");
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await expect(page.getByRole("dialog").getByText(/^Periodo:/)).toBeVisible();
  await page.getByRole("button", { name: "Generar borrador" }).click();
  await page.waitForURL(/\/reportes\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "Narrativa" })).toBeVisible();

  await page.getByRole("main").getByLabel("Titular").fill("Reporte e2e: titular editado");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(toast(page, "Cambios guardados")).toBeVisible();

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Aprobar" }).click();
  await expect(toast(page, /Aprobado/)).toBeVisible({ timeout: 60_000 });

  await page.reload();
  const link = page.getByRole("link", { name: "Descargar PDF" });
  await expect(link).toBeVisible();
  const pdf = await page.request.get((await link.getAttribute("href"))!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  const bytes = await pdf.body();
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  // The logo is embedded as an image (cover and footer).
  expect(bytes.toString("latin1")).toMatch(/\/Subtype\s*\/Image/);
  await expect(page.getByRole("heading", { name: "Reporte e2e: titular editado" })).toBeVisible();
}
