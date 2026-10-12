import { expect, test } from "@playwright/test";
import { admin, login, toast, USERS } from "./helpers";

const LECTURA = "00000000-0000-4000-d000-000000000005";

test("admin edita el rol de un usuario y no puede quitarse a sí mismo", async ({ page }) => {
  const db = admin();
  const { data: before } = await db.from("memberships").select("role, department_id").eq("user_id", LECTURA).single();
  try {
    await login(page, USERS.admin, "/configuracion/usuarios");
    await expect(page.getByRole("button", { name: `Quitar ${USERS.admin}` })).toBeDisabled();

    await page.getByRole("button", { name: `Editar ${USERS.lectura}` }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Rol" }).click();
    await page.getByRole("option", { name: "Comunicación" }).click();
    await dialog.getByRole("button", { name: "Guardar" }).click();
    await expect(toast(page, /Usuario actualizado: Comunicación/)).toBeVisible();
    const { data: after } = await db.from("memberships").select("role").eq("user_id", LECTURA).single();
    expect(after!.role).toBe("comunicacion");
  } finally {
    if (before) await db.from("memberships").update(before).eq("user_id", LECTURA);
  }
});
