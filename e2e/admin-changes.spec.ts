import { expect, test } from "@playwright/test";
import { noisyPng } from "./fixtures-png";
import { admin, login, toast, USERS } from "./helpers";

// Only Administración deletes a project (the mentions it captured are kept),
// and the client's logo goes up to 5 MB straight to Storage. Fictitious data.
const ORG = "00000000-0000-4000-a000-000000000001";

test.describe("borrar proyectos", () => {
  test("comunicación no ve el botón; administración borra con confirmación y las menciones se conservan", async ({ browser }) => {
    const db = admin();
    const name = `Proyecto temporal ${Date.now()}`;
    const { data: project } = await db.from("projects").insert({ org_id: ORG, name }).select("id").single();
    const { data: query } = await db.from("queries").insert({ org_id: ORG, project_id: project!.id, name: "Consulta temporal", expression: "bache" }).select("id").single();
    const { data: mention } = await db.from("mentions").select("id, query_id").eq("org_id", ORG).not("query_id", "is", null).limit(1).single();
    await db.from("mentions").update({ query_id: query!.id }).eq("id", mention!.id);
    const com = await browser.newPage();
    const adm = await browser.newPage();
    try {
      await login(com, USERS.comunicacion, `/configuracion/proyectos/${project!.id}`);
      await expect(com.getByRole("main").getByRole("heading", { name: "Ficha del proyecto" })).toBeVisible();
      await expect(com.getByRole("button", { name: "Borrar proyecto" })).toHaveCount(0);

      await login(adm, USERS.admin, `/configuracion/proyectos/${project!.id}`);
      await adm.getByRole("main").getByRole("button", { name: "Borrar proyecto" }).click();
      const dialog = adm.getByRole("dialog");
      const confirm = dialog.getByRole("button", { name: "Borrar proyecto" });
      await expect(confirm).toBeDisabled();
      await dialog.getByLabel("Escribe el nombre del proyecto para confirmar").fill(name);
      await confirm.click();
      await expect(toast(adm, "Proyecto borrado. Se conservaron 1 mención.")).toBeVisible();
      await expect(adm).toHaveURL(/\/configuracion\/proyectos$/);
      await expect(adm.getByRole("main").getByText(name)).toHaveCount(0);

      expect((await db.from("projects").select("id").eq("id", project!.id)).data).toHaveLength(0);
      const { data: kept } = await db.from("mentions").select("id, query_id").eq("id", mention!.id).single();
      expect(kept).toMatchObject({ id: mention!.id, query_id: null });
    } finally {
      await db.from("mentions").update({ query_id: mention!.query_id }).eq("id", mention!.id);
      await db.from("projects").delete().eq("id", project!.id);
      await Promise.all([com.close(), adm.close()]);
    }
  });
});

test.describe("logotipo", () => {
  test("administración sube un logotipo de ~3 MB (más que el límite anterior de 1 MB)", async ({ page }) => {
    const heavy = noisyPng(1000, 1000);
    expect(heavy.length).toBeGreaterThan(2.5 * 1024 * 1024);
    expect(heavy.length).toBeLessThan(5 * 1024 * 1024);
    const db = admin();
    try {
      await login(page, USERS.admin, "/configuracion/identidad");
      await page.getByRole("main").locator("#logo-file").setInputFiles({ name: "logo-grande.png", mimeType: "image/png", buffer: heavy });
      await expect(toast(page, "Logotipo guardado")).toBeVisible({ timeout: 30_000 });
      const { data } = await db.from("organizations").select("logo_path").eq("id", ORG).single();
      expect(data!.logo_path).toMatch(new RegExp(`^${ORG}/logo-\\d+\\.png$`));
    } finally {
      const { data } = await db.from("organizations").select("logo_path").eq("id", ORG).single();
      if (data?.logo_path) {
        await db.storage.from("branding").remove([data.logo_path]);
        await db.from("organizations").update({ logo_path: null }).eq("id", ORG);
      }
    }
  });
});
