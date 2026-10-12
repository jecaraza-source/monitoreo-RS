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

  test("comunicación turna a Agua con apoyo de Obras Públicas y Obras la recibe en vivo", async ({ browser }) => {
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
      await dialog.getByRole("combobox", { name: "Dependencia principal" }).click();
      await com.getByRole("option", { name: /^Agua Potable/ }).click();
      await dialog.getByRole("checkbox", { name: "Obras Públicas" }).check();
      await dialog.getByLabel("Nota para la dependencia (opcional)").fill(NOTE);
      await dialog.getByRole("button", { name: "Turnar" }).click();
      await expect(toast(com, /Turnada a Agua Potable.* \(principal\), con apoyo de Obras Públicas/)).toBeVisible();

      // The supporting department sees it without reloading, with the note.
      const routed = obras.locator(`article[data-mention-id="${target}"]`);
      await expect(routed).toBeVisible({ timeout: 20_000 });
      await routed.click();
      const aside = obras.locator('aside[aria-label="Detalle de la mención"]');
      await expect(aside.getByText(NOTE)).toBeVisible();
      await expect(aside.getByText("Apoyo", { exact: true })).toBeVisible();

      // Comunicación sees both, the leader first (it left the "new" list).
      await com.goto(`/bandeja?mention=${target}&status=all`);
      await live(com);
      await com.locator(`article[data-mention-id="${target}"]`).first().click();
      const detail = com.locator('aside[aria-label="Detalle de la mención"]');
      await expect(detail.getByText("Principal", { exact: true })).toBeVisible();
      await expect(detail.getByText("Apoyo", { exact: true })).toBeVisible();
    } finally {
      await db.from("tickets").delete().eq("mention_id", target);
      await db.from("mention_notes").delete().eq("mention_id", target).eq("body", NOTE);
      if (before) await db.from("mentions").update({ triage: before.triage }).eq("id", target);
      await com.close();
      await obras.close();
    }
  });
});
