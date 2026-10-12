import { expect, test } from "@playwright/test";
import { admin, login, toast, USERS } from "./helpers";

// A test official whose alias appears in the seed mentions (local and preview).
const NAME = "Funcionario Prueba E2E";
const ALIAS = "policía municipal";
const LECTURA = "00000000-0000-4000-d000-000000000005";

async function cleanUp() {
  const db = admin();
  await db.from("officials").delete().eq("name", NAME);
  await db.from("memberships").update({ can_view_officials: false }).eq("user_id", LECTURA);
}

test.describe("Percepción de funcionarios", () => {
  test.beforeEach(cleanUp);
  test.afterEach(cleanUp);

  test("sin autorización no aparece ni se puede abrir", async ({ page }) => {
    await login(page, USERS.lectura, "/dashboard");
    await expect(page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Funcionarios" })).toHaveCount(0);
    await page.goto("/funcionarios");
    await expect(page).not.toHaveURL(/\/funcionarios/);
  });

  test("admin agrega un funcionario, autoriza a Consulta y ésta ve el tablero con ciudadanos anónimos", async ({ page, context }) => {
    await login(page, USERS.admin, "/configuracion/catalogos");
    await page.getByLabel("Nombre", { exact: true }).fill(NAME);
    await page.getByLabel("Cargo").fill("Cargo de prueba");
    await page.getByLabel("Alias (separados por coma)").fill(ALIAS);
    await page.getByRole("button", { name: "Agregar funcionario" }).click();
    await expect(toast(page, "Funcionario agregado")).toBeVisible();

    await page.goto("/configuracion/usuarios");
    await page.getByRole("checkbox", { name: `Acceso a Funcionarios para ${USERS.lectura}` }).first().check();
    await expect(toast(page, "Acceso a Funcionarios otorgado")).toBeVisible();

    await context.clearCookies();
    await login(page, USERS.lectura, "/funcionarios?periodo=30d");
    await expect(page.getByText(/Acceso restringido/)).toBeVisible();
    const card = page.getByRole("link", { name: new RegExp(NAME) });
    await card.first().click();
    await expect(page.getByRole("heading", { name: new RegExp(NAME) })).toBeVisible();
    // Mentions of the alias are listed; citizens are never named.
    await expect(page.getByText(/policía municipal/i).first()).toBeVisible();
    await expect(page.getByText("Ciudadano").first()).toBeVisible();
    await expect(page.getByText(/@vecino_/)).toHaveCount(0);

    // The consultation is in the audit log.
    const { data: logged } = await admin().from("audit_log").select("id").eq("action", "view").eq("entity", "officials").eq("actor_id", LECTURA).limit(1);
    expect(logged?.length).toBe(1);
  });
});
