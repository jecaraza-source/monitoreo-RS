import { expect, test, type Page } from "@playwright/test";
import { SECTIONS, SUBSECTIONS, type Role } from "../src/lib/auth/roles";
import { admin, login, toast, USERS } from "./helpers";

// Stage 11: municipal configuration, contextual help and the operating
// exercise. Fictitious data; everything created here is removed at the end.
const ORG = "00000000-0000-4000-a000-000000000001";
const ADMIN_ID = "00000000-0000-4000-d000-000000000001";
const main = (page: Page) => page.getByRole("main");

const USER_BY_ROLE: Record<Role, string> = {
  admin: USERS.admin,
  comunicacion: USERS.comunicacion,
  dependencia: USERS.obras,
  lectura: USERS.lectura,
};

test.describe("menú con autorización real", () => {
  for (const role of Object.keys(USER_BY_ROLE) as Role[]) {
    test(`${role}: cada entrada del menú abre y lo ajeno redirige`, async ({ page }) => {
      test.setTimeout(120_000);
      await login(page, USER_BY_ROLE[role], "/ayuda");
      const nav = page.getByRole("navigation", { name: "Secciones" }).or(page.getByRole("navigation", { name: "Administración y ayuda" }));
      const hrefs = await nav.getByRole("link").evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).getAttribute("href")!));
      // The menu shows exactly the sections of the role (officials depends on a per-user grant).
      const restricted = new Set(SECTIONS.filter((s) => s.restricted).map((s) => s.href));
      expect(new Set(hrefs.filter((h) => !restricted.has(h)))).toEqual(new Set(SECTIONS.filter((s) => s.roles.includes(role) && !s.restricted).map((s) => s.href)));
      for (const href of hrefs) {
        await page.goto(href);
        await expect(page, href).toHaveURL(new RegExp(`${href}(/|\\?|$)`));
        // /configuracion redirects to the role's first subsection; on a deployment the
        // redirect can land after "load", so wait for it before the next navigation.
        if (href === "/configuracion") await page.waitForURL(/\/configuracion\/[\w-]+/);
      }
      for (const sub of SUBSECTIONS) {
        await page.goto(sub.href);
        if (sub.roles.includes(role)) await expect(page, sub.href).toHaveURL(new RegExp(`${sub.href}(\\?|$)`));
        else await expect(page, sub.href).not.toHaveURL(new RegExp(`${sub.href}(\\?|$)`));
      }
    });
  }
});

test.describe("configuración del municipio", () => {
  test("administración configura categorías, retención y la puesta en operación; todo queda auditado", async ({ page }) => {
    test.setTimeout(120_000);
    const db = admin();
    const name = `Categoría e2e ${Date.now()}`;
    const { data: previousPolicy } = await db.from("retention_policies").select("*").eq("org_id", ORG).maybeSingle();
    try {
      await login(page, USERS.admin, "/configuracion/municipio");
      await expect(main(page).getByRole("table", { name: "Elementos de configuración" }).getByText("SLA, horarios y días inhábiles")).toBeVisible();
      await expect(main(page).getByRole("heading", { name: /Puesta en operación \(\d+ de \d+\)/ })).toBeVisible();

      // A case category with the departments that can attend it.
      await page.goto("/configuracion/catalogos");
      const form = main(page).getByRole("form", { name: "Nueva categoría" });
      await form.getByLabel("Nombre de la categoría").fill(name);
      await form.getByLabel("Obras Públicas").check();
      await form.getByLabel("Dependencia sugerida").selectOption({ label: "Obras Públicas" });
      await form.getByRole("button", { name: "Agregar categoría" }).click();
      await expect(toast(page, "Categoría agregada.")).toBeVisible();
      await expect(main(page).getByRole("list", { name: "Categorías de caso" }).getByText(name)).toBeVisible();
      const { data: category } = await db.from("case_categories").select("id").eq("org_id", ORG).eq("name", name).single();
      const { data: audit } = await db.from("audit_log").select("actor_id, action").eq("entity", "case_categories").eq("entity_id", category!.id);
      expect(audit).toEqual([{ actor_id: ADMIN_ID, action: "insert" }]);

      // Retention: a term needs the municipal agreement.
      await page.goto("/configuracion/retencion");
      const policy = main(page).getByRole("form", { name: "Política de retención" });
      await policy.getByLabel("Eliminar menciones después de (meses)").fill("36");
      await policy.getByRole("button", { name: "Guardar política" }).click();
      await expect(toast(page, /referencia y la fecha del acuerdo/)).toBeVisible();
      await policy.getByLabel("Acuerdo del municipio (referencia)").fill("Acta de cabildo 7 (ficticia)");
      await policy.getByLabel("Fecha del acuerdo").fill("2026-09-01");
      await policy.getByRole("button", { name: "Guardar política" }).click();
      await expect(toast(page, /Política guardada/)).toBeVisible();
      await expect(main(page).getByRole("status").filter({ hasText: "Vigente: 36 meses" })).toBeVisible();
      await expect(main(page).getByLabel("Vista previa de la depuración")).toContainText("Se conservan por caso");

      // An authorized export is logged.
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
      const res = await page.request.get(`/api/exportar?tipo=casos&desde=${today.slice(0, 8)}01&hasta=${today}`);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("text/csv");
      expect((await res.text()).split("\n")[0]).toContain("Folio");
      const { data: logged } = await db.from("audit_log").select("id").eq("org_id", ORG).eq("action", "export").eq("actor_id", ADMIN_ID).gte("created_at", new Date(Date.now() - 60_000).toISOString());
      expect(logged!.length).toBeGreaterThan(0);

      // A per-role test recorded in the start-of-operation checklist.
      await page.goto("/configuracion/municipio");
      await main(page).getByLabel("Resultado: Prueba de Consulta").fill("Consulta revisó el dashboard y no pudo modificar nada");
      await main(page).getByRole("listitem").filter({ hasText: "Prueba de Consulta" }).getByRole("button", { name: "Registrar" }).click();
      await expect(toast(page, "Registrado en la lista de puesta en operación.")).toBeVisible();
      await expect(main(page).getByRole("listitem").filter({ hasText: "Consulta revisó el dashboard" })).toBeVisible();
    } finally {
      await db.from("onboarding_checks").delete().eq("org_id", ORG).eq("key", "prueba_lectura");
      await db.from("case_categories").delete().eq("org_id", ORG).eq("name", name);
      if (previousPolicy) await db.from("retention_policies").upsert(previousPolicy);
      else await db.from("retention_policies").delete().eq("org_id", ORG);
    }
  });

  test("lectura y dependencia no exportan; comunicación no cambia la retención", async ({ page }) => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
    await login(page, USERS.lectura, "/ayuda");
    expect((await page.request.get(`/api/exportar?tipo=casos&desde=${today}&hasta=${today}`)).status()).toBe(403);
    await login(page, USERS.obras, "/ayuda");
    expect((await page.request.get(`/api/exportar?tipo=casos&desde=${today}&hasta=${today}`)).status()).toBe(403);
    await login(page, USERS.comunicacion, "/ayuda");
    expect((await page.request.get(`/api/exportar?tipo=bitacora&desde=${today}&hasta=${today}`)).status()).toBe(403);
    await page.goto("/configuracion/retencion");
    await expect(page).not.toHaveURL(/\/configuracion\/retencion/);
  });
});

test.describe("ejercicio operativo", () => {
  test("un enlace completa la atención con la ayuda disponible", async ({ browser }) => {
    test.setTimeout(180_000);
    const db = admin();
    const [{ data: mentions }, { data: tickets }, { data: linked }] = await Promise.all([
      db.from("mentions").select("id, triage").eq("org_id", ORG).eq("status", "classified").neq("triage", "discarded").order("published_at").limit(300),
      db.from("tickets").select("mention_id").eq("org_id", ORG),
      db.from("case_mentions").select("mention_id").eq("org_id", ORG),
    ]);
    const busy = new Set([...(tickets ?? []), ...(linked ?? [])].map((r) => r.mention_id));
    const mention = (mentions ?? []).find((m) => !busy.has(m.id));
    test.skip(!mention, "La base no tiene menciones libres.");
    const title = `Ejercicio e2e: luminaria apagada ${Date.now()}`;
    const { data: caseId, error } = await db.rpc("create_case", { p_org_id: ORG, p_mention_ids: [mention!.id], p_title: title, p_priority: "medium" });
    expect(error).toBeNull();
    const com = await browser.newPage();
    const obras = await browser.newPage();
    try {
      // Coordination assigns to Obras.
      await login(com, USERS.comunicacion, `/casos/${caseId}`);
      await main(com).getByRole("button", { name: "Asignar" }).click();
      const dialog = com.getByRole("dialog");
      await dialog.getByRole("combobox", { name: "Dependencia responsable" }).click();
      await com.getByRole("option", { name: "Obras Públicas" }).click();
      await dialog.getByRole("button", { name: "Asignar" }).click();
      await expect(toast(com, "Caso asignado.")).toBeVisible();

      // The enlace opens the help of the case: what it receives, accept/return, evidence, validation.
      await login(obras, USERS.obras, `/casos/${caseId}`);
      await main(obras).getByRole("button", { name: "Ayuda" }).click();
      const help = obras.getByRole("dialog");
      await expect(help.getByRole("heading", { name: "Aceptar o devolver" })).toBeVisible();
      await expect(help.getByRole("heading", { name: "Qué evidencia aportar" })).toBeVisible();
      await expect(help.getByText(/Solicitar validación/).first()).toBeVisible();
      // Internal notes are not part of the department's help.
      await expect(help.getByText(/Nota interna/)).toHaveCount(0);
      await obras.keyboard.press("Escape");

      for (const step of ["Aceptar", "Iniciar atención"]) {
        await main(obras).getByRole("button", { name: step, exact: true }).click();
        await expect(toast(obras, "Estado del caso actualizado.").last()).toBeVisible();
      }
      await main(obras).getByLabel("Avance", { exact: true }).fill("Luminaria reemplazada; se adjunta reporte de cuadrilla.");
      await main(obras).getByRole("button", { name: "Reportar avance" }).click();
      await expect(toast(obras, /Avance registrado/)).toBeVisible();
      await main(obras).getByRole("button", { name: "Solicitar validación" }).click();
      await expect(toast(obras, "Estado del caso actualizado.").last()).toBeVisible();

      // Coordination validates and closes.
      await com.reload();
      await main(com).getByRole("button", { name: "Validar" }).click();
      const close = com.getByRole("dialog");
      await close.getByLabel("Resultado de la atención").fill("Luminaria reemplazada.");
      await close.getByLabel("Revisé la evidencia y es suficiente para cerrar.").check();
      await close.getByRole("button", { name: "Validar y cerrar" }).click();
      await expect(toast(com, "Caso validado y cerrado.")).toBeVisible();
      expect((await db.from("cases").select("status").eq("id", caseId).single()).data!.status).toBe("closed");
    } finally {
      await db.from("tickets").delete().eq("case_id", caseId);
      await db.from("cases").delete().eq("id", caseId);
      await db.from("mentions").update({ triage: mention!.triage as "new" }).eq("id", mention!.id);
    }
  });
});
