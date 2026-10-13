import { expect, test, type Page } from "@playwright/test";
import { solidPng, withTextChunk } from "./fixtures-png";
import { admin, login, toast, USERS } from "./helpers";

// Stage 6: attention of a case end to end, and the evidence policy. Fictitious data.
const ORG = "00000000-0000-4000-a000-000000000001";
const TITLE = "Prueba e2e: fuga en la calle Allende";

async function freeMention() {
  const db = admin();
  const [{ data: mentions }, { data: tickets }, { data: linked }] = await Promise.all([
    db.from("mentions").select("id, triage").eq("org_id", ORG).eq("status", "classified").neq("triage", "discarded").order("published_at").limit(300),
    db.from("tickets").select("mention_id").eq("org_id", ORG),
    db.from("case_mentions").select("mention_id").eq("org_id", ORG),
  ]);
  const busy = new Set([...(tickets ?? []), ...(linked ?? [])].map((r) => r.mention_id));
  return (mentions ?? []).find((m) => !busy.has(m.id)) ?? null;
}

async function cleanup(caseId: string, mention: { id: string; triage: string }) {
  const db = admin();
  const { data: files } = await db.from("case_evidence").select("path").eq("case_id", caseId);
  // Uploads whose registration failed are under the same folder.
  const { data: folder } = await db.storage.from("case-evidence").list(`${ORG}/${caseId}`);
  const paths = [...new Set([...(files ?? []).map((f) => f.path), ...(folder ?? []).map((f) => `${ORG}/${caseId}/${f.name}`)])];
  if (paths.length) await db.storage.from("case-evidence").remove(paths);
  await db.from("tickets").delete().eq("case_id", caseId);
  await db.from("cases").delete().eq("id", caseId);
  await db.from("mentions").update({ triage: mention.triage as "new" }).eq("id", mention.id);
}

const main = (page: Page) => page.getByRole("main");
const updates = (page: Page) => main(page).getByRole("list", { name: "Avances del caso" });

async function report(page: Page, text: string, opts: { files?: { name: string; mimeType: string; buffer: Buffer }[]; onlyCoordination?: boolean } = {}) {
  await main(page).getByLabel("Avance", { exact: true }).fill(text);
  if (opts.files) await main(page).locator("#case-update-files").setInputFiles(opts.files);
  if (opts.onlyCoordination) await main(page).getByRole("radio", { name: "Sólo mi área y Comunicación" }).check();
  await main(page).getByRole("button", { name: "Reportar avance" }).click();
}

/** The evidence links of the update with this text. */
async function evidenceLinks(page: Page, text: string) {
  const item = updates(page).getByRole("listitem").filter({ hasText: text });
  await expect(item.getByRole("link").first()).toBeVisible();
  return item.getByRole("link").evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).getAttribute("href")!));
}

test.describe("atención de casos", () => {
  test("asignar con plazos, tareas entre áreas, evidencia, devolver, cerrar con resultado y reabrir sin perder historial", async ({ browser }) => {
    const mention = await freeMention();
    test.skip(!mention, "La base no tiene menciones libres.");
    const db = admin();
    const { data: caseId, error } = await db.rpc("create_case", { p_org_id: ORG, p_mention_ids: [mention!.id], p_title: TITLE, p_priority: "high" });
    expect(error).toBeNull();
    const com = await browser.newPage();
    const obras = await browser.newPage();
    const agua = await browser.newPage();
    const anonymous = await browser.newContext();
    try {
      // Comunicación assigns: lead, support, responsible person, acceptance deadline, commitment.
      await login(com, USERS.comunicacion, `/casos/${caseId}`);
      await expect(com.getByRole("heading", { name: TITLE })).toBeVisible();
      await main(com).getByRole("button", { name: "Asignar" }).click();
      const dialog = com.getByRole("dialog");
      await dialog.getByRole("combobox", { name: "Dependencia responsable" }).click();
      await com.getByRole("option", { name: "Obras Públicas" }).click();
      await dialog.getByRole("combobox", { name: "Persona responsable" }).click();
      await com.getByRole("option", { name: "Enlace Obras Públicas" }).click();
      await dialog.getByLabel("Agua Potable y Alcantarillado").check();
      await expect(dialog.getByLabel("Plazo de aceptación")).not.toHaveValue("");
      await dialog.getByLabel("Qué se compromete a hacer (opcional)").fill("Reparar la fuga y reponer el pavimento");
      await dialog.getByRole("button", { name: "Asignar" }).click();
      await expect(toast(com, "Caso asignado.")).toBeVisible();
      await expect(main(com).getByText("Reparar la fuga y reponer el pavimento")).toBeVisible();
      // Coordination cannot close or accept for the department without saying why.
      await expect(main(com).getByRole("button", { name: "Validar" })).toHaveCount(0);
      await expect(main(com).getByRole("button", { name: "Aceptar (en nombre de la dependencia)" })).toBeVisible();

      // Obras (lead) accepts, starts, gives Agua a task and reports with evidence.
      await login(obras, USERS.obras, `/casos/${caseId}`);
      for (const step of ["Aceptar", "Iniciar atención"]) {
        await main(obras).getByRole("button", { name: step, exact: true }).click();
        await expect(toast(obras, "Estado del caso actualizado.").last()).toBeVisible();
      }
      await main(obras).getByRole("button", { name: "Agregar tarea" }).click();
      const task = main(obras).getByRole("form", { name: "Nueva tarea" });
      await task.getByRole("textbox", { name: "Tarea" }).fill("Cerrar la válvula de la red");
      await task.getByRole("combobox", { name: "Área de la tarea" }).click();
      await obras.getByRole("option", { name: "Agua Potable y Alcantarillado" }).click();
      await task.getByRole("button", { name: "Agregar" }).click();
      await expect(toast(obras, "Tarea agregada.")).toBeVisible();

      // Evidence policy: the bytes decide, not the name.
      await report(obras, "Intento con un archivo disfrazado.", { files: [{ name: "foto.png", mimeType: "image/png", buffer: Buffer.from("<html>no es imagen</html>") }] });
      await expect(toast(obras, "Sólo se aceptan fotos JPG o PNG y documentos PDF.")).toBeVisible();
      await main(obras).getByRole("button", { name: "Quitar foto.png" }).click();

      const photo = withTextChunk(solidPng(64, 48, [40, 90, 160]), "GPS", "19.4326N 99.1332W Juan Perez");
      await report(obras, "Fuga localizada y excavación abierta.", { files: [{ name: "IMG_2026_juan.png", mimeType: "image/png", buffer: photo }] });
      await expect(toast(obras, "Avance registrado con 1 archivo.")).toBeVisible();
      await report(obras, "Costo interno de la reparación.", { files: [{ name: "costo.png", mimeType: "image/png", buffer: solidPng(32, 32, [0, 0, 0]) }], onlyCoordination: true });
      await expect(toast(obras, "Avance registrado con 1 archivo.").last()).toBeVisible();

      const [shared] = await evidenceLinks(obras, "Fuga localizada");
      const [internal] = await evidenceLinks(obras, "Costo interno");

      // Download: a 60-second signed link, after checking permission; GPS and author removed.
      const res = await obras.request.get(shared, { maxRedirects: 0 });
      expect(res.status()).toBe(302);
      const signed = res.headers()["location"];
      expect(signed).toContain("/storage/v1/object/sign/case-evidence/");
      const file = await obras.request.get(signed);
      expect(file.status()).toBe(200);
      const body = Buffer.from(await file.body());
      expect(body.subarray(0, 4).toString("latin1")).toBe("\x89PNG");
      expect(body.includes(Buffer.from("GPS"))).toBe(false);
      expect(body.includes(Buffer.from("Juan Perez"))).toBe(false);

      // Agua (support) sees its task and the shared evidence, not what Obras sent only to coordination.
      await login(agua, USERS.agua, `/casos/${caseId}`);
      const aguaTasks = main(agua).getByRole("list", { name: "Tareas del caso" });
      await expect(aguaTasks.getByText("Cerrar la válvula de la red")).toBeVisible();
      await expect(updates(agua).getByText("Costo interno de la reparación.")).toHaveCount(0);
      expect((await agua.request.get(shared, { maxRedirects: 0 })).status()).toBe(302);
      expect((await agua.request.get(internal, { maxRedirects: 0 })).status()).toBe(404);
      // Without a session there is no link at all.
      const anon = await anonymous.request.get(`${new URL(com.url()).origin}${shared}`, { maxRedirects: 0 });
      expect(anon.headers()["location"] ?? "").not.toContain("/storage/v1/object/sign/");
      // Support cannot move the case.
      await expect(main(agua).getByRole("button", { name: "Solicitar validación" })).toHaveCount(0);
      await aguaTasks.getByRole("button", { name: "Marcar hecha" }).click();
      await expect(toast(agua, "Tarea actualizada.")).toBeVisible();

      // Obras requests validation.
      await obras.reload();
      await main(obras).getByRole("button", { name: "Solicitar validación" }).click();
      await expect(toast(obras, "Estado del caso actualizado.").last()).toBeVisible();
      await expect(main(obras).getByText("Pendiente de validación").first()).toBeVisible();
      await expect(main(obras).getByRole("button", { name: "Validar" })).toHaveCount(0);

      // Comunicación returns it: the reason is recorded, evidence stays.
      await com.reload();
      await main(com).getByRole("button", { name: "Validar" }).click();
      const validate = com.getByRole("dialog");
      await validate.getByRole("radio", { name: /Devolver a la dependencia/ }).check();
      await validate.getByLabel("Motivo de la devolución").fill("Falta la foto del pavimento repuesto.");
      await validate.getByRole("button", { name: "Devolver a atención" }).click();
      await expect(toast(com, "Caso devuelto a atención.")).toBeVisible();

      await obras.reload();
      await report(obras, "Pavimento repuesto y calle abierta.", { files: [{ name: "final.png", mimeType: "image/png", buffer: solidPng(64, 48, [120, 120, 120]) }] });
      await expect(toast(obras, "Avance registrado con 1 archivo.").last()).toBeVisible();
      await main(obras).getByRole("button", { name: "Solicitar validación" }).click();
      await expect(toast(obras, "Estado del caso actualizado.").last()).toBeVisible();

      // Comunicación closes with a result after confirming the evidence.
      await com.reload();
      await main(com).getByRole("button", { name: "Validar" }).click();
      const close = com.getByRole("dialog");
      await close.getByLabel("Resultado de la atención").fill("Fuga reparada y pavimento repuesto.");
      await expect(close.getByRole("button", { name: "Validar y cerrar" })).toBeDisabled();
      await close.getByLabel("Revisé la evidencia y es suficiente para cerrar.").check();
      await close.getByRole("button", { name: "Validar y cerrar" }).click();
      await expect(toast(com, "Caso validado y cerrado.")).toBeVisible();
      await expect(main(com).getByText("Resultado: Fuga reparada y pavimento repuesto.")).toBeVisible();

      // The problem persists: reopened with evidence, a new cycle; nothing earlier is lost.
      await main(com).getByRole("button", { name: "Reabrir" }).click();
      const reopen = com.getByRole("dialog");
      await reopen.getByLabel("Por qué el problema persiste").fill("Vecinos envían foto: sigue saliendo agua.");
      await reopen.locator("#case-reopen-files").setInputFiles([{ name: "vecinos.png", mimeType: "image/png", buffer: solidPng(48, 48, [20, 120, 200]) }]);
      await reopen.getByRole("button", { name: "Reabrir" }).click();
      await expect(toast(com, "Caso reabierto: empieza un nuevo ciclo.")).toBeVisible();
      const times = main(com).getByRole("list", { name: "Tiempos por ciclo" });
      await expect(times.getByText("Ciclo 2")).toBeVisible();
      await expect(times.getByText("Ciclo 1")).toBeVisible();
      await expect(times.getByText("Devuelto a atención · Comunicación Social")).toBeVisible();
      await expect(times.getByText("Validado y cerrado · Comunicación Social")).toBeVisible();
      await expect(updates(com).getByRole("link")).toHaveCount(4);
      const history = main(com).getByRole("list", { name: "Historial del caso" });
      await expect(history.getByText("Pendiente de validación → Cerrado")).toBeVisible();
      await expect(history.getByText("Pendiente de validación → En atención")).toBeVisible();
      await expect(history.getByText("Reabrió el caso: Cerrado → En revisión")).toBeVisible();
      const { count } = await db.from("case_milestones").select("id", { count: "exact", head: true }).eq("case_id", caseId as string).eq("cycle", 1);
      expect(count).toBeGreaterThanOrEqual(8);
    } finally {
      await cleanup(caseId as string, mention!);
      await com.close();
      await obras.close();
      await agua.close();
      await anonymous.close();
    }
  });
});
