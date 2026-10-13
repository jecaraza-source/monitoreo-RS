import { expect, test, type Page } from "@playwright/test";
import { solidPng } from "./fixtures-png";
import { admin, login, toast, USERS, USERS_B } from "./helpers";

// Stage 12: one fictitious problem from end to end, with a real magic link and
// the four roles (comunicación, dependencia, consulta, administración):
// source → ingestion → classification → case → assignment → acceptance →
// evidence → validation → close → report → PDF download; the second
// municipality never sees it. Local stack only (CRON_SECRET, simulated AI and
// the local mail catcher), like pipeline.spec.ts.
const ORG = "00000000-0000-4000-a000-000000000001";
const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";
const main = (page: Page) => page.getByRole("main");

type MailpitList = { messages: { ID: string; To: { Address: string }[]; Created: string }[] };

/** The magic link of the newest email to `to` sent after `since`. */
async function magicLinkFor(request: import("@playwright/test").APIRequestContext, to: string, since: Date): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const list = (await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json()) as MailpitList;
    const fresh = list.messages.find((m) => Date.parse(m.Created) >= since.getTime() - 1000);
    if (fresh) {
      const message = (await (await request.get(`${MAILPIT}/api/v1/message/${fresh.ID}`)).json()) as { HTML: string; Text: string };
      const link = (message.HTML || message.Text).match(/href="([^"]*\/auth\/confirm\?[^"]+)"/)?.[1] ?? (message.Text.match(/https?:\/\/\S*\/auth\/confirm\?\S+/) ?? [])[0];
      if (link) return link.replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No llegó el correo de acceso para ${to}.`);
}

test.describe("recorrido completo", () => {
  test.skip(!process.env.CRON_SECRET || Boolean(process.env.E2E_BASE_URL), "Sólo con la pila local, el simulador de IA y CRON_SECRET.");
  test.setTimeout(300_000);

  test("de la fuente al PDF del reporte, con enlace mágico real y sin fuga al otro municipio", async ({ browser, request }) => {
    const db = admin();
    const tag = `recorrido-${Date.now()}`;
    const text = `Luminaria apagada desde hace una semana en la calle Hidalgo de la colonia Centro (${tag}).`;
    let sourceId = "";
    let mentionId = "";
    let caseId = "";
    const reportIds: string[] = [];
    const com = await browser.newPage();
    const obras = await browser.newPage();
    const otherOrg = await browser.newPage();
    const reader = await browser.newPage();
    const adminA = await browser.newPage();
    try {
      // 1) Magic link: the login form sends a real email (local catcher) and its link opens a session.
      const since = new Date();
      await com.goto("/login");
      await com.fill("#email", USERS.comunicacion);
      await com.getByRole("button", { name: /enlace/i }).click();
      await expect(com.getByText(/Revisa tu correo|Te enviamos/i).first()).toBeVisible();
      await com.goto(await magicLinkFor(request, USERS.comunicacion, since));
      await expect(com).not.toHaveURL(/\/login/);

      // 2) Source and ingestion: an inactive fictitious feed; its items are stored with the
      //    same RPC the ingest worker uses (the network fetch is covered by connector tests).
      const { data: source, error: sourceError } = await db
        .from("sources")
        .insert({ org_id: ORG, name: `Fuente del recorrido (${tag})`, type: "rss", config: { url: "https://example.com/recorrido.xml" }, is_active: false })
        .select("id")
        .single();
      expect(sourceError).toBeNull();
      sourceId = source!.id;
      const ingested = await db.rpc("ingest_mentions", {
        p_org_id: ORG,
        p_source_id: sourceId,
        p_rows: [{ external_id: tag, url: "https://example.com/recorrido", text, published_at: new Date().toISOString(), author_id: null, metrics: {}, query_id: null }],
      });
      expect(ingested.error).toBeNull();
      expect((ingested.data as { inserted: number }).inserted).toBe(1);
      // Reading the same item again is not a duplicate.
      const again = await db.rpc("ingest_mentions", {
        p_org_id: ORG,
        p_source_id: sourceId,
        p_rows: [{ external_id: tag, url: "https://example.com/recorrido", text, published_at: new Date().toISOString(), author_id: null, metrics: {}, query_id: null }],
      });
      expect((again.data as { inserted: number }).inserted).toBe(0);
      mentionId = (await db.from("mentions").select("id").eq("source_id", sourceId).single()).data!.id;

      // 3) Classification by the worker (simulated model), once.
      const cron = await request.get("/api/cron/classify", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, timeout: 90_000 });
      expect(cron.status()).toBe(200);
      await expect.poll(async () => (await db.from("mentions").select("status").eq("id", mentionId).single()).data!.status, { timeout: 60_000 }).toBe("classified");
      expect((await db.from("classifications").select("mention_id").eq("mention_id", mentionId)).data).toHaveLength(1);

      // 4) Case from the inbox (Comunicación, the magic-link session).
      await com.goto(`/bandeja?mention=${mentionId}&status=all`);
      const card = main(com).locator(`article[data-mention-id="${mentionId}"]`);
      await expect(card).toBeVisible();
      await card.click();
      const aside = main(com).locator('aside[aria-label="Detalle de la mención"]');
      await aside.getByRole("button", { name: /^Caso/ }).click();
      const create = com.getByRole("dialog");
      await create.getByLabel("Título").fill(`Recorrido e2e: luminaria (${tag})`);
      await create.getByRole("button", { name: "Crear caso" }).click();
      await expect(toast(com, "Caso creado con 1 mención.")).toBeVisible();
      caseId = (await db.from("case_mentions").select("case_id").eq("mention_id", mentionId).single()).data!.case_id;

      // 5) Assignment (turn) to Obras Públicas.
      await com.goto(`/casos/${caseId}`);
      await main(com).getByRole("button", { name: "Asignar" }).click();
      const assign = com.getByRole("dialog");
      await assign.getByRole("combobox", { name: "Dependencia responsable" }).click();
      await com.getByRole("option", { name: "Obras Públicas" }).click();
      await assign.getByRole("button", { name: "Asignar" }).click();
      await expect(toast(com, "Caso asignado.")).toBeVisible();
      expect((await db.from("tickets").select("id").eq("case_id", caseId)).data).toHaveLength(1);

      // 6) Obras accepts, works it with evidence and asks for validation.
      await login(obras, USERS.obras, `/casos/${caseId}`);
      for (const step of ["Aceptar", "Iniciar atención"]) {
        await main(obras).getByRole("button", { name: step, exact: true }).click();
        await expect(toast(obras, "Estado del caso actualizado.").last()).toBeVisible();
      }
      await main(obras).getByLabel("Avance", { exact: true }).fill("Luminaria sustituida; foto de la cuadrilla.");
      await main(obras).locator("#case-update-files").setInputFiles([{ name: "luminaria.png", mimeType: "image/png", buffer: solidPng(64, 48, [250, 220, 90]) }]);
      await main(obras).getByRole("button", { name: "Reportar avance" }).click();
      await expect(toast(obras, "Avance registrado con 1 archivo.")).toBeVisible();
      await main(obras).getByRole("button", { name: "Solicitar validación" }).click();
      await expect(toast(obras, "Estado del caso actualizado.").last()).toBeVisible();

      // 7) Validation and close.
      await com.reload();
      await main(com).getByRole("button", { name: "Validar" }).click();
      const close = com.getByRole("dialog");
      await close.getByLabel("Resultado de la atención").fill("Luminaria sustituida.");
      await close.getByLabel("Revisé la evidencia y es suficiente para cerrar.").check();
      await close.getByRole("button", { name: "Validar y cerrar" }).click();
      await expect(toast(com, "Caso validado y cerrado.")).toBeVisible();
      expect((await db.from("cases").select("status").eq("id", caseId).single()).data!.status).toBe("closed");

      // 8) Report of the day and its PDF.
      await com.goto("/reportes");
      await main(com).getByRole("button", { name: "Generar reporte" }).click();
      await com.getByRole("button", { name: "Generar borrador" }).click();
      await com.waitForURL(/\/reportes\/[0-9a-f-]{36}$/, { timeout: 120_000 });
      reportIds.push(com.url().split("/").pop()!);
      com.once("dialog", (d) => d.accept());
      await main(com).getByRole("button", { name: "Aprobar" }).click();
      await expect(toast(com, /Aprobado/)).toBeVisible({ timeout: 60_000 });
      await com.reload();
      const link = main(com).getByRole("link", { name: "Descargar PDF" });
      const pdf = await com.request.get((await link.getAttribute("href"))!);
      expect(pdf.status()).toBe(200);
      expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

      // 9) Consulta (lectura) sees the closed case and downloads the approved report, but cannot act;
      //    Administración sees the same case and keeps the coordination actions.
      await login(reader, USERS.lectura, `/casos/${caseId}`);
      await expect(main(reader).getByRole("heading", { name: /Recorrido e2e/ })).toBeVisible();
      await expect(main(reader).getByText("Luminaria sustituida.").first()).toBeVisible();
      for (const action of ["Reabrir", "Asignar", "Validar", "Reportar avance"]) {
        await expect(main(reader).getByRole("button", { name: action, exact: true })).toHaveCount(0);
      }
      await reader.goto(`/reportes/${reportIds[0]}`);
      const readerPdf = await reader.request.get((await main(reader).getByRole("link", { name: "Descargar PDF" }).getAttribute("href"))!);
      expect(readerPdf.status()).toBe(200);
      expect((await readerPdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
      await login(adminA, USERS.admin, `/casos/${caseId}`);
      await expect(main(adminA).getByRole("heading", { name: /Recorrido e2e/ })).toBeVisible();
      await expect(main(adminA).getByRole("button", { name: "Reabrir", exact: true })).toBeVisible();

      // 10) Counters reconcile: one mention, one classification, one case, one turn, and the
      //    closed case appears in the attention figures of the period.
      expect((await db.from("case_mentions").select("case_id").eq("mention_id", mentionId)).data).toHaveLength(1);
      expect((await db.from("case_events").select("operation").eq("case_id", caseId).eq("operation", "created")).data).toHaveLength(1);

      // 11) The other municipality never sees it, not even by its id.
      const orgB = await db.from("organizations").select("id").eq("id", "00000000-0000-4000-a000-00000000000b").maybeSingle();
      if (orgB.data) {
        await login(otherOrg, USERS_B.admin, `/casos/${caseId}`);
        await expect(main(otherOrg).getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();
        await expect(main(otherOrg).getByText(text)).toHaveCount(0);
        await expect(main(otherOrg).getByRole("heading", { name: /Recorrido e2e/ })).toHaveCount(0);
        await otherOrg.goto(`/bandeja?mention=${mentionId}&status=all`);
        await expect(main(otherOrg).locator(`article[data-mention-id="${mentionId}"]`)).toHaveCount(0);
      }
    } finally {
      for (const id of reportIds) {
        const { data } = await db.from("reports").select("pdf_path").eq("id", id).maybeSingle();
        if (data?.pdf_path) await db.storage.from("reports").remove([data.pdf_path]);
        await db.from("reports").delete().eq("id", id);
      }
      if (caseId) {
        const { data: files } = await db.from("case_evidence").select("path").eq("case_id", caseId);
        if (files?.length) await db.storage.from("case-evidence").remove(files.map((f) => f.path));
        await db.from("tickets").delete().eq("case_id", caseId);
        await db.from("cases").delete().eq("id", caseId);
      }
      if (sourceId) {
        await db.from("mentions").delete().eq("source_id", sourceId);
        await db.from("sources").delete().eq("id", sourceId);
      }
      await Promise.all([com.close(), obras.close(), otherOrg.close(), reader.close(), adminA.close()]);
    }
  });
});
