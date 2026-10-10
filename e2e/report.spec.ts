import { expect, test } from "@playwright/test";
import { login, toast, USERS } from "./helpers";

test.describe("reportes", () => {
  test.setTimeout(180_000);

  test("el reporte semanal se genera, se edita, se aprueba y se descarga en PDF", async ({ page }) => {
    await login(page, USERS.comunicacion, "/reportes");
    await page.getByRole("button", { name: "Generar reporte" }).click();
    await expect(page.getByText(/^Periodo:/)).toBeVisible();
    await page.getByRole("button", { name: "Generar borrador" }).click();
    await page.waitForURL(/\/reportes\/[0-9a-f-]{36}$/, { timeout: 120_000 });
    await expect(page.getByRole("heading", { name: "Narrativa" })).toBeVisible();

    await page.getByLabel("Titular").fill("Reporte e2e: titular editado");
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
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    await expect(page.getByRole("heading", { name: "Reporte e2e: titular editado" })).toBeVisible();
  });
});
