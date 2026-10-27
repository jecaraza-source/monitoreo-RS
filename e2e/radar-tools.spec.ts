import { expect, test } from "@playwright/test";
import { admin, login, toast, USERS } from "./helpers";

const ORG = "00000000-0000-4000-a000-000000000001";
const COMUNICACION = "00000000-0000-4000-d000-000000000002";
const TITLE = "Pago de apoyos falso e2e";

async function cleanUp() {
  const db = admin();
  await db.from("ci_checks").delete().eq("org_id", ORG);
  await db.from("ci_settings").delete().eq("org_id", ORG);
  await db.from("ci_reports").delete().eq("org_id", ORG).eq("title", TITLE);
  await db.from("memberships").update({ can_view_counterintel: false }).eq("user_id", COMUNICACION);
}

test.describe("Radar Social: herramientas de verificación", () => {
  // The services are answered by the local mock; a preview would call the real ones.
  test.skip(!process.env.RADAR_CRTSH_URL || Boolean(process.env.E2E_BASE_URL), "Sólo con el simulador local de servicios.");
  test.beforeEach(cleanUp);
  test.afterEach(cleanUp);

  test("dominios parecidos, revisión de indicadores, verificaciones y medios; todo queda registrado", async ({ page }) => {
    await admin().from("memberships").update({ can_view_counterintel: true }).eq("user_id", COMUNICACION);
    await login(page, USERS.comunicacion, "/radar-social");

    // Settings, then the certificate search: the official domain is left out, the lookalike shows.
    const settings = page.getByRole("form", { name: "Ajustes del radar" });
    await settings.getByLabel("Dominios oficiales (uno por línea)").fill("valle.gob.mx");
    await settings.getByLabel("Términos a vigilar (uno por línea)").fill("valle");
    await settings.getByRole("button", { name: "Guardar ajustes" }).click();
    await expect(toast(page, "Ajustes del radar guardados.")).toBeVisible();
    await page.getByRole("button", { name: "Buscar dominios parecidos" }).click();
    await expect(toast(page, /Consulta lista/)).toBeVisible();
    const lookalikes = page.getByRole("list", { name: "Dominios parecidos con valle" });
    await expect(lookalikes.getByText("apoyos-valle-falso.mx")).toBeVisible();
    await expect(lookalikes.getByText("valle.gob.mx", { exact: true })).toHaveCount(0);

    // A report with a suspicious domain: its indicators are checked.
    const form = page.getByRole("form", { name: "Nuevo reporte" });
    await form.getByRole("combobox", { name: "Tipo de reporte" }).click();
    await page.getByRole("option", { name: "Suplantación de cuenta o página" }).click();
    await form.getByLabel("Título").fill(TITLE);
    await form.getByLabel("Indicadores (uno por línea)").fill("https://pago-falso.mx/apoyos\n@cuenta_falsa");
    await form.getByRole("button", { name: "Registrar reporte" }).click();
    await expect(toast(page, "Reporte registrado.")).toBeVisible();
    const report = page.getByRole("list", { name: "Reportes de Radar Social" }).getByRole("listitem").filter({ hasText: TITLE });
    await report.getByRole("button", { name: "Revisar indicadores" }).click();
    await expect(toast(page, /3 alertas/)).toBeVisible();
    const checks = report.getByRole("list", { name: "Revisión de indicadores" });
    await expect(checks.getByText("Alerta")).toHaveCount(3);
    await expect(checks.getByText(/URLhaus \(abuse\.ch\): Listado/)).toBeVisible();

    // Published fact checks and news coverage.
    const search = page.getByRole("form", { name: "Buscar verificaciones y medios" });
    await search.getByLabel("Afirmación o tema").fill("apoyo falso adultos mayores");
    await search.getByRole("button", { name: "Buscar verificaciones" }).click();
    await expect(toast(page, /1 verificación publicada/)).toBeVisible();
    await expect(page.getByText("Se cancela el apoyo para adultos mayores")).toBeVisible();
    await search.getByRole("button", { name: "Buscar en medios" }).click();
    await expect(page.getByRole("link", { name: /Desmienten rumor sobre el agua/ })).toBeVisible();

    // Every check is in the log, with who ran it.
    const { data } = await admin().from("ci_checks").select("provider, checked_by").eq("org_id", ORG);
    expect(new Set(data!.map((c) => c.provider))).toEqual(new Set(["crtsh", "urlhaus", "phishstats", "safe_browsing", "factcheck", "gdelt"]));
    expect(data!.every((c) => c.checked_by === COMUNICACION)).toBe(true);
  });
});
