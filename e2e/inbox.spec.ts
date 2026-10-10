import { expect, test } from "@playwright/test";
import { login, toast, USERS } from "./helpers";

const live = (page: import("@playwright/test").Page) => page.getByText("En vivo", { exact: true }).waitFor({ timeout: 20_000 });

test.describe("bandeja y turnado", () => {
  test("comunicación filtra la bandeja y abre el detalle", async ({ page }) => {
    await login(page, USERS.comunicacion, "/bandeja");
    await live(page);
    const cards = page.locator("article[data-mention-id]");
    await expect(cards.first()).toBeVisible();
    await page.goto("/bandeja?sentiment=negative&status=all");
    await live(page);
    await expect(cards.first()).toBeVisible();
    await cards.first().click();
    const aside = page.locator('aside[aria-label="Detalle de la mención"]');
    await expect(aside).toBeVisible();
    await expect(aside.getByText(/negativ/i).first()).toBeVisible();
  });

  test("comunicación turna a Obras Públicas y la dependencia la recibe en vivo", async ({ browser }) => {
    const com = await browser.newPage();
    const obras = await browser.newPage();
    await login(obras, USERS.obras, "/bandeja");
    await live(obras);

    await login(com, USERS.comunicacion, "/bandeja?status=new");
    await live(com);
    const first = com.locator("article[data-mention-id]").first();
    await expect(first).toBeVisible();
    const target = await first.getAttribute("data-mention-id");
    await first.click();
    await com.locator("body").press("t");
    const dialog = com.getByRole("dialog");
    await expect(dialog.getByText("Turnar mención")).toBeVisible();
    await dialog.getByRole("combobox", { name: "Dependencia" }).click();
    await com.getByRole("option", { name: "Obras Públicas" }).click();
    await dialog.getByLabel("Nota para la dependencia (opcional)").fill("Prueba e2e: favor de atender.");
    await dialog.getByRole("button", { name: "Turnar" }).click();
    await expect(toast(com, /Turnad/)).toBeVisible();

    // The department sees it without reloading, with the note.
    const routed = obras.locator(`article[data-mention-id="${target}"]`);
    await expect(routed).toBeVisible({ timeout: 20_000 });
    await routed.click();
    await expect(obras.locator('aside[aria-label="Detalle de la mención"]').getByText("Prueba e2e: favor de atender.")).toBeVisible();
    await com.close();
    await obras.close();
  });
});
