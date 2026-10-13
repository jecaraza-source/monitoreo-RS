import { expect, test, type Page } from "@playwright/test";
import { admin, login, toast, USERS } from "./helpers";

// Stage 9: conversation and attention KPIs with their definitions, the
// department breakdown, and reports whose approved figures never change.
const ORG = "00000000-0000-4000-a000-000000000001";
const main = (page: Page) => page.getByRole("main");
/** The figure of a KPI card (the card whose h3 is the label). */
const card = (page: Page, label: string) => main(page).locator('[data-slot="card"]').filter({ has: page.getByRole("heading", { name: label, exact: true, level: 3 }) });

/** Start of the dashboard's 7-day period: six Mexico City days before today, at 00:00. */
function weekStart(): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  const d = new Date(`${today}T00:00:00-06:00`);
  return new Date(d.getTime() - 6 * 86_400_000).toISOString();
}

test.describe("indicadores y reportes", () => {
  test.setTimeout(180_000);

  test("el dashboard separa menciones y casos, y cada indicador reproduce su consulta base", async ({ page }) => {
    const db = admin();
    const from = weekStart();
    const now = new Date().toISOString();
    const [{ count: mentions }, { count: cases }] = await Promise.all([
      db.from("mentions").select("id", { count: "exact", head: true }).eq("org_id", ORG).gte("published_at", from).lt("published_at", now),
      db.from("cases").select("id", { count: "exact", head: true }).eq("org_id", ORG).neq("status", "merged").gte("opened_at", from).lt("opened_at", now),
    ]);

    await login(page, USERS.comunicacion, "/dashboard");
    await expect(main(page).getByRole("heading", { name: "Conversación y percepción", level: 2 })).toBeVisible();
    await expect(main(page).getByRole("heading", { name: "Atención y cumplimiento", level: 2 })).toBeVisible();
    await expect(main(page).getByText(/Unidad: menciones \(publicaciones\)/)).toBeVisible();
    await expect(main(page).getByText(/Unidad: casos \(incidentes\)/)).toBeVisible();

    // Mentions and cases: the same counts as a direct query of the period.
    await expect(card(page, "Menciones").locator(".text-3xl .sr-only")).toHaveText(new Intl.NumberFormat("es-MX").format(mentions ?? 0));
    await expect(card(page, "Casos nuevos").locator(".text-3xl .sr-only")).toHaveText(new Intl.NumberFormat("es-MX").format(cases ?? 0));

    // Coverage and last update are on the page.
    const coverage = main(page).getByRole("region", { name: "Cobertura y actualización" });
    await expect(coverage.getByText("Corte:", { exact: true })).toBeVisible();
    await expect(coverage.getByText("Sin clasificar:", { exact: true })).toBeVisible();
    await expect(coverage.getByText(/KPI-\d{4}\.\d{2}/)).toBeVisible();

    // The dictionary behind each (i): formula, denominator, treatment of reopened cases.
    await card(page, "Tiempo de resolución (mediana)").getByRole("button", { name: /Qué es/ }).click();
    const tip = page.getByRole("dialog").filter({ hasText: "Fórmula" });
    await expect(tip).toContainText("Reabiertos: Cada ciclo cuenta por separado");
    await expect(tip).toContainText("Denominador: Ciclos cerrados en el periodo (n).");
    await page.keyboard.press("Escape");

    // Department breakdown (not a ranking) and its CSV with the same rows.
    const table = main(page).getByRole("table", { name: "Casos por dependencia" });
    await expect(table).toBeVisible();
    const download = page.waitForEvent("download");
    await main(page).getByRole("button", { name: "CSV" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^casos-por-dependencia-.*\.csv$/);
  });

  test("un reporte aprobado conserva sus cifras; la revisión es otra versión con cifras al día y texto verificado", async ({ page }) => {
    const db = admin();
    await login(page, USERS.comunicacion, "/reportes");
    await page.getByRole("button", { name: "Generar reporte" }).click();
    await page.getByRole("button", { name: "Generar borrador" }).click();
    await page.waitForURL(/\/reportes\/[0-9a-f-]{36}$/, { timeout: 120_000 });
    const firstId = page.url().split("/").pop()!;
    await expect(main(page).getByRole("heading", { name: "Atención y cumplimiento" })).toBeVisible();
    await expect(main(page).getByRole("status").filter({ hasText: "verificados contra los datos" })).toBeVisible();
    await expect(main(page).getByText("Qué requiere decisión", { exact: true }).first()).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await main(page).getByRole("button", { name: "Aprobar" }).click();
    await expect(toast(page, /Aprobado/)).toBeVisible({ timeout: 60_000 });
    const { data: approved } = await db.from("reports").select("facts, period_start, period_end, kpi_version, version").eq("id", firstId).single();
    expect(approved!.version).toBe(1);
    expect(approved!.kpi_version).toMatch(/^KPI-/);

    // Operational data of the period change after the approval (a reclassification).
    const { data: target } = await db
      .from("mentions")
      .select("id, classifications!inner(sentiment)")
      .eq("org_id", ORG)
      .eq("classifications.sentiment", "positive")
      .gte("published_at", `${approved!.period_start}T06:00:00Z`)
      .lte("published_at", `${approved!.period_end}T23:00:00Z`)
      .limit(1)
      .maybeSingle();
    test.skip(!target, "El periodo no tiene menciones positivas para corregir.");
    await db.from("classifications").update({ sentiment: "negative" }).eq("mention_id", target!.id);
    let revisionId: string | null = null;
    try {
      // The approved report keeps its figures.
      const { data: still } = await db.from("reports").select("facts").eq("id", firstId).single();
      expect(still!.facts).toEqual(approved!.facts);

      // A revision: version 2, linked, with figures computed now.
      await page.reload();
      page.once("dialog", (d) => d.accept());
      await main(page).getByRole("button", { name: "Crear revisión" }).click();
      await page.waitForURL((url) => !url.pathname.endsWith(firstId), { timeout: 120_000 });
      revisionId = page.url().split("/").pop()!;
      await expect(main(page).getByText("Versión 2")).toBeVisible();
      await expect(main(page).getByRole("link", { name: "versión 1" })).toBeVisible();
      const { data: revision } = await db.from("reports").select("facts, previous_version_id, version, status").eq("id", revisionId).single();
      expect([revision!.version, revision!.previous_version_id, revision!.status]).toEqual([2, firstId, "draft"]);
      const nss = (f: unknown) => (f as { kpis: { key: string; value: number }[] }).kpis.find((k) => k.key === "nss")?.value;
      expect(nss(revision!.facts)).toBeLessThan(nss(approved!.facts)!);
      expect(nss((await db.from("reports").select("facts").eq("id", firstId).single()).data!.facts)).toBe(nss(approved!.facts));

      // A statement without evidence blocks the approval.
      const first = main(page).getByRole("group", { name: "Qué cambió" }).locator(".rounded-lg.border").first();
      const chips = first.locator("span.rounded-full button");
      while (await chips.count()) await chips.first().click();
      await expect(main(page).getByText(/Qué cambió 1: falta la evidencia/)).toBeVisible();
      await main(page).getByRole("button", { name: "Guardar cambios" }).click();
      await expect(toast(page, /Antes de aprobar corrige/)).toBeVisible();
      page.once("dialog", (d) => d.accept());
      await main(page).getByRole("button", { name: "Aprobar" }).click();
      await expect(toast(page, /No se puede aprobar/)).toBeVisible();
      expect((await db.from("reports").select("status").eq("id", revisionId).single()).data!.status).toBe("draft");
    } finally {
      await db.from("classifications").update({ sentiment: "positive" }).eq("mention_id", target!.id);
      if (revisionId) await db.from("reports").delete().eq("id", revisionId);
    }
  });

  test("un reporte del formato anterior se sigue viendo, se aprueba y genera su PDF", async ({ page }) => {
    const db = admin();
    // Facts and narrative as stored before stage 9 (routed mentions as attention, findings).
    const facts = {
      municipality: "Municipio de prueba",
      state: null,
      period: { kind: "weekly", label: "Del 2 al 8 de octubre de 2025", previous_label: "la semana anterior", start: "2025-10-02", end: "2025-10-08" },
      kpis: [{ key: "mentions", label: "Menciones", value: 200, previous: 160, change: 25, change_unit: "%" }],
      sentiment: { positive_pct: 22, neutral_pct: 28, negative_pct: 50, nss: -27.8, nss_previous: -10 },
      top_topics: [{ topic: "agua potable", mentions: 60, share_pct: 33.3, negative_pct: 75, nss: -66.7 }],
      departments_by_nss: [{ department: "Agua Potable", mentions: 70, negative: 50, nss: -64.3 }],
      neighborhoods_most_complaints: [{ neighborhood: "Centro", complaints: 6, top_topic: "agua potable" }],
      peaks: [],
      alerts: { total: 0, critical: 0, high: 0, medium: 0, low: 0, useful: 0, false_alarms: 0, latest: [] },
      attention: { routed: 14, resolved: 4, resolution_pct: 28.6, avg_hours: 27.2, overdue: 4, by_department: [{ department: "Agua Potable", routed: 14, resolved: 4, overdue: 4, avg_hours: 20.4 }] },
      targets: [],
      series: [{ bucket: "2025-10-02T06:00:00Z", positive: 1, neutral: 2, negative: 3 }],
      representative_mentions: [],
    };
    const content = {
      headline: "200 menciones en la semana",
      executive_summary: "Hubo 200 menciones; el agua potable sumó 60.",
      findings: [{ title: "Agua potable", evidence: "60 menciones, 75% negativas.", impact: "Atender pipas." }],
      risks: ["Bloqueos."],
      opportunities: ["Difundir reparaciones."],
      recommendations: [{ action: "Reforzar pipas.", owner: "Agua Potable", deadline: "48 horas" }],
      messaging: ["El Ayuntamiento atiende los reportes."],
    };
    const { data, error } = await db
      .from("reports")
      .insert({ org_id: ORG, period: "weekly", period_start: "2025-10-02", period_end: "2025-10-08", title: "Reporte anterior (e2e)", facts, content })
      .select("id")
      .single();
    expect(error).toBeNull();
    try {
      await login(page, USERS.comunicacion, `/reportes/${data!.id}`);
      await expect(main(page).getByRole("heading", { name: "Hallazgos" })).toBeVisible();
      await expect(main(page).getByText(/usa el formato anterior/)).toBeVisible();
      page.once("dialog", (d) => d.accept());
      await main(page).getByRole("button", { name: "Aprobar" }).click();
      await expect(toast(page, /Aprobado/)).toBeVisible({ timeout: 60_000 });
      await page.reload();
      const link = main(page).getByRole("link", { name: "Descargar PDF" });
      const pdf = await page.request.get((await link.getAttribute("href"))!);
      expect(pdf.status()).toBe(200);
      expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    } finally {
      const { data: row } = await db.from("reports").select("pdf_path").eq("id", data!.id).single();
      if (row?.pdf_path) await db.storage.from("reports").remove([row.pdf_path]);
      await db.from("reports").delete().eq("id", data!.id);
    }
  });

  test("una dependencia no ve los indicadores del municipio", async ({ page }) => {
    await login(page, USERS.obras, "/bandeja");
    await page.goto("/dashboard");
    await expect(page).not.toHaveURL(/\/dashboard/);
    await page.goto("/reportes");
    await expect(page).not.toHaveURL(/\/reportes/);
  });
});
