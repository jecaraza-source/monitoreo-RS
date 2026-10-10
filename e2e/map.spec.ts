import { expect, test } from "@playwright/test";
import { login, USERS } from "./helpers";

test.describe("mapa de colonias", () => {
  test("lectura cambia la métrica, abre una colonia y llega a la bandeja filtrada", async ({ page }) => {
    await login(page, USERS.lectura, "/mapa?periodo=30d");
    await expect(page.getByRole("heading", { name: "Mapa", level: 1 })).toBeVisible();
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();

    // The metric changes the URL without a server round trip.
    await page.getByRole("radio", { name: "Sentimiento neto" }).click();
    await expect(page).toHaveURL(/metrica=nss/);
    await expect(page.getByRole("heading", { name: /Ranking por sentimiento neto/ })).toBeVisible();

    // A colonia from the ranking opens its panel.
    await page.getByRole("radio", { name: "Menciones" }).click();
    const first = page.locator("ol li button").first();
    const name = (await first.locator("span.truncate").first().textContent())?.trim() ?? "";
    await first.click();
    await expect(page).toHaveURL(/colonia=/);
    const panel = page.getByRole("heading", { name, level: 2 });
    await expect(panel).toBeVisible();
    await expect(page.getByRole("heading", { name: "Turnos", level: 3 })).toBeVisible();

    await page.getByRole("link", { name: /Ver todas en la bandeja/ }).click();
    await expect(page).toHaveURL(/\/bandeja\?.*neighborhood=/);
  });

  test("dependencia no tiene acceso al mapa del municipio", async ({ page }) => {
    await login(page, USERS.obras, "/bandeja");
    await page.goto("/mapa");
    await expect(page).not.toHaveURL(/\/mapa/);
  });
});
