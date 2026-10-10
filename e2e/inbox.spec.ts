import { expect, test } from "@playwright/test";
import { admin, login, toast, USERS } from "./helpers";

const NOTE = "Prueba e2e: favor de atender.";

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
    const target = (await first.getAttribute("data-mention-id"))!;
    // The suite also runs against the persistent preview database: leave the
    // mention as found, or routed mentions pile up in Obras' inbox and push
    // the new one out of the rendered window on later runs.
    const db = admin();
    const { data: before } = await db.from("mentions").select("triage").eq("id", target).single();
    try {
      await first.click();
      await com.locator("body").press("t");
      const dialog = com.getByRole("dialog");
      await expect(dialog.getByText("Turnar mención")).toBeVisible();
      await dialog.getByRole("combobox", { name: "Dependencia" }).click();
      await com.getByRole("option", { name: "Obras Públicas" }).click();
      await dialog.getByLabel("Nota para la dependencia (opcional)").fill(NOTE);
      await dialog.getByRole("button", { name: "Turnar" }).click();
      await expect(toast(com, /Turnad/)).toBeVisible();

      // The department sees it without reloading, with the note.
      const routed = obras.locator(`article[data-mention-id="${target}"]`);
      await expect(routed).toBeVisible({ timeout: 20_000 });
      await routed.click();
      await expect(obras.locator('aside[aria-label="Detalle de la mención"]').getByText(NOTE)).toBeVisible();
    } finally {
      const { data: obrasDept } = await db.from("departments").select("id").eq("name", "Obras Públicas").single();
      if (obrasDept) await db.from("tickets").delete().eq("mention_id", target).eq("department_id", obrasDept.id);
      await db.from("mention_notes").delete().eq("mention_id", target).eq("body", NOTE);
      if (before) await db.from("mentions").update({ triage: before.triage }).eq("id", target);
      await com.close();
      await obras.close();
    }
  });
});
