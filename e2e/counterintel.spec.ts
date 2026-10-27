import { expect, test } from "@playwright/test";
import { admin, login, toast, USERS } from "./helpers";

const ORG = "00000000-0000-4000-a000-000000000001";
const ADMIN = "00000000-0000-4000-d000-000000000001";
const COMUNICACION = "00000000-0000-4000-d000-000000000002";
const LECTURA = "00000000-0000-4000-d000-000000000005";
const TITLE = "Página falsa e2e pide datos para apoyos";
const MENU = "Radar Social";

async function cleanUp() {
  const db = admin();
  await db.from("ci_reports").delete().eq("org_id", ORG).eq("title", TITLE);
  await db.from("memberships").update({ can_view_counterintel: false }).in("user_id", [ADMIN, COMUNICACION, LECTURA]);
}

test.describe("Radar Social", () => {
  test.beforeEach(cleanUp);
  test.afterEach(cleanUp);

  test("sin autorización no aparece ni para Administración, ni se abre por URL", async ({ page }) => {
    await login(page, USERS.admin, "/dashboard");
    await expect(page.getByRole("link", { name: MENU })).toHaveCount(0);
    await page.goto("/radar-social");
    await expect(page).not.toHaveURL(/\/radar-social/);
  });

  test("admin autoriza a Comunicación, que registra un reporte; Consulta autorizada lo lee sin poder registrar", async ({ page, context }) => {
    await login(page, USERS.admin, "/configuracion/usuarios");
    await page.getByRole("checkbox", { name: `Acceso a ${MENU} para ${USERS.comunicacion}` }).first().check();
    await expect(toast(page, "Acceso a Radar Social otorgado")).toBeVisible();
    await page.getByRole("checkbox", { name: `Acceso a ${MENU} para ${USERS.lectura}` }).first().check();
    await expect(toast(page, "Acceso a Radar Social otorgado").last()).toBeVisible();
    // The admin did not authorize themselves: still no office.
    await page.goto("/radar-social");
    await expect(page).not.toHaveURL(/\/radar-social/);

    await context.clearCookies();
    await login(page, USERS.comunicacion, "/dashboard");
    await page.getByRole("link", { name: MENU }).first().click();
    await expect(page.getByRole("heading", { name: MENU, level: 1 })).toBeVisible();
    await expect(page.getByText(/las críticas no son desinformación/)).toBeVisible();

    const form = page.getByRole("form", { name: "Nuevo reporte" });
    await form.getByRole("combobox", { name: "Tipo de reporte" }).click();
    await page.getByRole("option", { name: "Suplantación de cuenta o página" }).click();
    await form.getByLabel("Título").fill(TITLE);
    await form.getByLabel("Indicadores (uno por línea)").fill("apoyos-falsos-e2e.mx\n@ayto_falso_e2e");
    await form.getByRole("button", { name: "Registrar reporte" }).click();
    await expect(toast(page, "Reporte registrado.")).toBeVisible();
    const report = page.getByRole("list", { name: "Reportes de Radar Social" }).getByRole("listitem").filter({ hasText: TITLE });
    await expect(report).toBeVisible();
    await expect(report.getByText("apoyos-falsos-e2e.mx")).toBeVisible();

    await report.getByRole("button", { name: "Pasar a seguimiento" }).click();
    await expect(toast(page, "Estado del reporte actualizado.")).toBeVisible();
    await expect(report.getByText("En seguimiento")).toBeVisible();

    await context.clearCookies();
    await login(page, USERS.lectura, "/radar-social");
    // Scoped to the visible list: while the page streams, React briefly keeps a hidden copy of it.
    await expect(page.getByRole("list", { name: "Reportes de Radar Social" }).getByText(TITLE)).toBeVisible();
    await expect(page.getByRole("form", { name: "Nuevo reporte" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pasar a seguimiento" })).toHaveCount(0);

    // The consultations are in the audit log.
    const { count } = await admin()
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("entity", "counterintel")
      .eq("action", "view")
      .in("actor_id", [COMUNICACION, LECTURA]);
    expect(count ?? 0).toBeGreaterThanOrEqual(2);
  });

  test("una dependencia no puede recibir el acceso", async ({ page }) => {
    await login(page, USERS.admin, "/configuracion/usuarios");
    await expect(page.getByRole("checkbox", { name: `Acceso a ${MENU} para ${USERS.obras}` })).toHaveCount(0);
  });
});
