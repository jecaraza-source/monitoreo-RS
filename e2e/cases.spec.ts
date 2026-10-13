import { expect, test } from "@playwright/test";
import { admin, login, toast, USERS } from "./helpers";

const ORG = "00000000-0000-4000-a000-000000000001";
const TITLE = "Prueba e2e: fuga en la calle Hidalgo";

const live = (page: import("@playwright/test").Page) => page.getByText("En vivo", { exact: true }).waitFor({ timeout: 20_000 });

/** Mentions of the seed without turns or case, to leave as found afterwards. */
async function freeMentions(n: number) {
  const db = admin();
  const [{ data: mentions }, { data: tickets }, { data: linked }] = await Promise.all([
    db.from("mentions").select("id, triage").eq("org_id", ORG).eq("status", "classified").neq("triage", "discarded").order("published_at", { ascending: false }).limit(300),
    db.from("tickets").select("mention_id").eq("org_id", ORG),
    db.from("case_mentions").select("mention_id").eq("org_id", ORG),
  ]);
  const busy = new Set([...(tickets ?? []), ...(linked ?? [])].map((r) => r.mention_id));
  return (mentions ?? []).filter((m) => !busy.has(m.id)).slice(0, n);
}

/** Removes a test case and what it created (turns), restoring the mentions. */
async function cleanup(caseIds: string[], mentions: { id: string; triage: string }[]) {
  const db = admin();
  if (caseIds.length) {
    await db.from("tickets").delete().in("case_id", caseIds);
    await db.from("cases").delete().in("id", caseIds);
  }
  for (const m of mentions) await db.from("mentions").update({ triage: m.triage as "new" }).eq("id", m.id);
}

test.describe("casos", () => {
  test("18 menciones de una fuga son un caso y siguen contando como 18; la dependencia lo atiende y Comunicación lo cierra", async ({ browser }) => {
    const db = admin();
    const mentions = await freeMentions(18);
    test.skip(mentions.length < 18, "La base no tiene 18 menciones libres.");
    // Created as the system (service role) to focus the UI test on the workflow.
    const { data: caseId, error } = await db.rpc("create_case", {
      p_org_id: ORG,
      p_mention_ids: mentions.map((m) => m.id),
      p_title: TITLE,
      p_priority: "high",
    });
    expect(error).toBeNull();
    const com = await browser.newPage();
    const obras = await browser.newPage();
    const agua = await browser.newPage();
    try {
      await login(com, USERS.comunicacion, `/casos/${caseId}`);
      await expect(com.getByRole("heading", { name: TITLE })).toBeVisible();
      await expect(com.getByText("18 menciones", { exact: true })).toBeVisible();

      // Assign to Obras Públicas.
      await com.getByRole("button", { name: "Asignar" }).click();
      const dialog = com.getByRole("dialog");
      await dialog.getByRole("combobox", { name: "Dependencia responsable" }).click();
      await com.getByRole("option", { name: "Obras Públicas" }).click();
      await dialog.getByRole("button", { name: "Asignar" }).click();
      await expect(toast(com, "Caso asignado.")).toBeVisible();

      // The mentions still count one by one: the case groups, it does not replace them.
      const { count } = await db.from("mentions").select("id", { count: "exact", head: true }).in("id", mentions.map((m) => m.id));
      expect(count).toBe(18);

      // Obras sees it in its list and moves it forward.
      await login(obras, USERS.obras, "/casos");
      await obras.getByRole("link", { name: new RegExp(TITLE) }).click();
      for (const step of ["Aceptar", "Iniciar atención", "Marcar atendido"]) {
        await obras.getByRole("button", { name: step }).click();
        await expect(toast(obras, "Estado del caso actualizado.").last()).toBeVisible();
      }
      await expect(obras.getByText("Atendido, por validar").first()).toBeVisible();
      // No internal notes or editor actions for the department.
      await expect(obras.getByRole("button", { name: "Validar y cerrar" })).toHaveCount(0);
      await expect(obras.getByText("Interna (sólo Comunicación)")).toHaveCount(0);

      // Agua Potable is not assigned: the case does not exist for it.
      await login(agua, USERS.agua, `/casos/${caseId}`);
      await expect(agua.getByRole("heading", { name: TITLE })).toHaveCount(0);

      // Comunicación validates and closes; the history tells the story.
      await com.reload();
      await com.getByRole("button", { name: "Validar y cerrar" }).click();
      await expect(toast(com, "Estado del caso actualizado.")).toBeVisible();
      const history = com.getByRole("list", { name: "Historial del caso" });
      await expect(history.getByText("Atendido, por validar → Cerrado")).toBeVisible();
      await expect(history.getByText("Asignado → Aceptado")).toBeVisible();
      await expect(history.getByText(/Enlace Obras Públicas/).first()).toBeVisible();
    } finally {
      await cleanup([caseId as string], mentions);
      await com.close();
      await obras.close();
      await agua.close();
    }
  });

  test("comunicación crea un caso desde la bandeja", async ({ page }) => {
    const [mention] = await freeMentions(1);
    test.skip(!mention, "La base no tiene menciones libres.");
    const db = admin();
    try {
      await login(page, USERS.comunicacion, `/bandeja?mention=${mention.id}&status=all`);
      await live(page);
      await page.locator(`article[data-mention-id="${mention.id}"]`).first().click();
      await page.locator("body").press("c");
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Título").fill(TITLE);
      await dialog.getByRole("button", { name: "Crear caso" }).click();
      await expect(toast(page, "Caso creado con 1 mención.")).toBeVisible();
      await expect(page.locator('aside[aria-label="Detalle de la mención"]').getByText(/Parte del caso C-\d{5}/)).toBeVisible();
    } finally {
      const { data } = await db.from("case_mentions").select("case_id").eq("mention_id", mention.id);
      await cleanup((data ?? []).map((r) => r.case_id), [mention]);
    }
  });
});
