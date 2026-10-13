import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { admin, login, toast, USERS } from "./helpers";

const ORG = "00000000-0000-4000-a000-000000000001";
const SOURCE = "00000000-0000-4000-e200-000000000002";

type Seeded = { id: string };

/** Fictitious mentions with a model classification (written with the service key, like the classifier). */
async function seed(rows: { text: string; classification: Record<string, unknown> }[]): Promise<Seeded[]> {
  const db = admin();
  const out: Seeded[] = [];
  for (const r of rows) {
    const id = randomUUID();
    const { error } = await db.from("mentions").insert({
      id,
      org_id: ORG,
      source_id: SOURCE,
      external_id: `e2e-triage-${id}`,
      text: r.text,
      published_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      status: "classified",
      triage: "new",
    });
    if (error) throw new Error(error.message);
    const { error: cError } = await db.from("classifications").insert({ org_id: ORG, mention_id: id, model: "e2e", ...r.classification });
    if (cError) throw new Error(cError.message);
    out.push({ id });
  }
  return out;
}

async function cleanup(ids: string[]) {
  const db = admin();
  const { data: links } = await db.from("case_mentions").select("case_id").in("mention_id", ids);
  const caseIds = [...new Set((links ?? []).map((l) => l.case_id))];
  if (caseIds.length) {
    await db.from("tickets").delete().in("case_id", caseIds);
    await db.from("cases").delete().in("id", caseIds);
  }
  await db.from("tickets").delete().in("mention_id", ids);
  await db.from("mentions").delete().in("id", ids);
}

test.describe("bandeja operativa y revisión", () => {
  test("la vista Urgentes pone primero la emergencia, su contador coincide y turnarla pide el canal institucional", async ({ page }) => {
    const [emergency, critique] = await seed([
      {
        text: "Prueba e2e: se incendia una bodega junto a la primaria, hay humo en las casas",
        classification: { sentiment: "negative", confidence: 0.97, topic: "seguridad pública", intent: "denuncia", priority: "high", severity: "emergency", incident_type: "civil_protection", needs_attention: true },
      },
      {
        text: "Prueba e2e: este gobierno no sirve para nada",
        classification: { sentiment: "negative", confidence: 0.95, topic: "gestión del gobierno", intent: "otro", priority: "low", severity: "none", incident_type: "none", needs_attention: false },
      },
    ]);
    try {
      await login(page, USERS.comunicacion, "/bandeja?view=urgent");
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { name: "Bandeja · Urgentes" })).toBeVisible();
      // The emergency leads; the mere critique is not urgent.
      await expect(main.locator("article").first()).toHaveAttribute("data-mention-id", emergency.id);
      await expect(main.locator(`article[data-mention-id="${critique.id}"]`)).toHaveCount(0);

      // Counter on the tab = size of the list (same database function).
      const tab = main.getByRole("navigation", { name: "Vistas de la bandeja" }).getByRole("link", { name: /^Urgentes/ });
      const n = Number((await tab.locator("span").textContent())?.replace(/\D/g, ""));
      await expect(main.getByText(`${n.toLocaleString("es-MX")} en esta vista`)).toBeVisible();

      // Routing an emergency shows the policy and waits for the acknowledgement.
      await main.locator(`article[data-mention-id="${emergency.id}"]`).click();
      await main.locator('aside[aria-label="Detalle"]').getByRole("button", { name: /^Turnar/ }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText(/Protección Civil municipal/)).toBeVisible();
      await dialog.getByRole("combobox", { name: "Dependencia principal" }).click();
      await page.getByRole("option", { name: "Obras Públicas" }).click();
      await expect(dialog.getByRole("button", { name: "Turnar" })).toBeDisabled();
      await dialog.getByRole("checkbox", { name: /Se derivó/ }).check();
      await dialog.getByRole("button", { name: "Turnar" }).click();
      await expect(toast(page, /Turnada a Obras Públicas/)).toBeVisible();
    } finally {
      await cleanup([emergency.id, critique.id]);
    }
  });

  test("turnar en bloque informa cuántas se turnaron y cuáles no", async ({ page }) => {
    const [free, linked] = await seed([
      { text: "Prueba e2e: luminaria apagada en la calle Morelos", classification: { sentiment: "negative", confidence: 0.9, topic: "alumbrado público", intent: "queja", priority: "medium", severity: "low", incident_type: "public_service", needs_attention: true } },
      { text: "Prueba e2e: otra luminaria apagada en Morelos", classification: { sentiment: "negative", confidence: 0.9, topic: "alumbrado público", intent: "queja", priority: "medium", severity: "low", incident_type: "public_service", needs_attention: true } },
    ]);
    const db = admin();
    const { data: caseId, error } = await db.rpc("create_case", { p_org_id: ORG, p_mention_ids: [linked.id], p_title: "Prueba e2e: luminarias" });
    expect(error).toBeNull();
    try {
      // Server-side check of the bulk action, then the message the person sees.
      await login(page, USERS.comunicacion, `/bandeja?status=all&q=${encodeURIComponent("luminaria Morelos")}`);
      const main = page.getByRole("main");
      for (const id of [free.id, linked.id]) {
        const card = main.locator(`article[data-mention-id="${id}"]`);
        await expect(card).toBeVisible();
        await card.getByRole("checkbox").check();
      }
      await main.getByRole("button", { name: "Turnar", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("combobox", { name: "Dependencia principal" }).click();
      await page.getByRole("option", { name: "Obras Públicas" }).click();
      await dialog.getByRole("button", { name: "Turnar" }).click();
      await expect(toast(page, /1 sin turnar: pertenece a C-\d{5}/)).toBeVisible();
      const { count } = await db.from("tickets").select("id", { count: "exact", head: true }).in("mention_id", [free.id, linked.id]).is("case_id", null);
      expect(count).toBe(1);
    } finally {
      await cleanup([free.id, linked.id]);
      if (caseId) await db.from("cases").delete().eq("id", caseId);
    }
  });

  test("la revisión humana corrige con motivo, guarda la versión previa y el dashboard se actualiza", async ({ page }) => {
    const [doubtful] = await seed([
      {
        text: "Prueba e2e: qué bonito, cuarto día sin agua, gracias presidente 👏",
        classification: { sentiment: "positive", confidence: 0.4, topic: "agua potable", intent: "elogio", priority: "low", severity: "none", incident_type: "none", needs_attention: false },
      },
    ]);
    const db = admin();
    try {
      await login(page, USERS.comunicacion, "/bandeja/revision");
      const card = page.getByRole("main").locator("article", { hasText: "cuarto día sin agua" });
      await expect(card.getByText("Baja confianza")).toBeVisible();
      await expect(card.getByText(/Modelo e2e · confianza 40/)).toBeVisible();
      await card.getByRole("button", { name: "Corregir" }).click();
      await card.getByRole("combobox", { name: "Sentimiento" }).click();
      await page.getByRole("option", { name: "Negativo" }).click();
      await card.getByRole("combobox", { name: "Intención" }).click();
      await page.getByRole("option", { name: "Queja" }).click();
      await card.getByLabel("Motivo de la corrección").fill("Sarcasmo: es una queja por falta de agua");
      await card.getByRole("button", { name: "Guardar corrección" }).click();
      await expect(toast(page, "Corrección guardada.")).toBeVisible();

      const { data: versions } = await db.from("classification_versions").select("snapshot, reason").eq("mention_id", doubtful.id);
      expect(versions?.length).toBe(1);
      expect((versions![0].snapshot as { sentiment: string }).sentiment).toBe("positive");
      expect(versions![0].reason).toBe("Sarcasmo: es una queja por falta de agua");
      // The aggregates catch up right after the correction (durable queue processed).
      await expect
        .poll(async () => (await db.from("stats_invalidations").select("processed_at").eq("mention_id", doubtful.id).single()).data?.processed_at ?? null, {
          timeout: 15_000,
        })
        .not.toBeNull();
    } finally {
      await cleanup([doubtful.id]);
    }
  });

  test("una dependencia sólo ve las vistas de su trabajo y no entra a la revisión", async ({ page }) => {
    await login(page, USERS.obras, "/bandeja?view=acceptance");
    const tabs = page.getByRole("main").getByRole("navigation", { name: "Vistas de la bandeja" });
    await expect(tabs.getByRole("link", { name: /^Por aceptar/ })).toBeVisible();
    await expect(tabs.getByRole("link", { name: /^Nuevas/ })).toHaveCount(0);
    await expect(tabs.getByRole("link", { name: /Revisión/ })).toHaveCount(0);
    await page.goto("/bandeja/revision");
    await expect(page).not.toHaveURL(/\/bandeja\/revision/);
  });
});
