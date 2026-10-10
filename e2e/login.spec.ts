import { expect, test } from "@playwright/test";
import { login, USERS } from "./helpers";

test.describe("login", () => {
  test("sin sesión, las secciones mandan al login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
    await expect(page.getByRole("button", { name: /enlace/i })).toBeVisible();
  });

  test("el formulario no revela si un correo existe", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#email", "nadie-registrado@ejemplo.test");
    await page.getByRole("button", { name: /enlace/i }).click();
    await expect(page.getByText("Revisa tu correo")).toBeVisible();
  });

  test("comunicación entra al dashboard y una dependencia a su bandeja", async ({ page, context }) => {
    await login(page, USERS.comunicacion);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();

    await context.clearCookies();
    await login(page, USERS.obras);
    await expect(page).toHaveURL(/\/bandeja/);
    // Executive sections are closed to a department.
    await page.goto("/reportes");
    await expect(page).toHaveURL(/\/bandeja/);
  });

  test("un enlace inválido regresa al login con aviso", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=pkce_invalido&type=magiclink");
    await expect(page).toHaveURL(/\/login\?error=link/);
  });
});
