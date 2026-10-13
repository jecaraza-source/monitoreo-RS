import { expect, test, type APIRequestContext } from "@playwright/test";
import { solidPng } from "./fixtures-png";
import { admin, apiAs, canCallApiDirectly, login, toast, USERS } from "./helpers";

// Stage 12: injected failures. Provider errors and timeouts, a worker that dies
// holding its lease, two people acting on the same case at once, a human
// correction the model must not overwrite and Storage refusing a file. Each
// test checks recovery, that nothing is duplicated and that the run counters
// add up. The email provider failure and its outbox retry are in
// delivery.spec.ts. Local stack only (simulated AI, CRON_SECRET).
const MOCK = process.env.E2E_MOCK_URL ?? "http://127.0.0.1:4010";
const ORG = "00000000-0000-4000-a000-000000000001";
const SOURCE = "00000000-0000-4000-e200-000000000002";
const OBRAS = "00000000-0000-4000-b000-000000000001";

type OrgCounters = { claimed: number; saved: number; keptCorrection: number; stale: number; retry: number; dead: number; released: number };
type Run = { ok: boolean; runId?: string; stoppedBy?: string; orgs?: Record<string, OrgCounters> };

const cron = async (request: APIRequestContext) => {
  const res = await request.get("/api/cron/classify", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, timeout: 120_000 });
  return { status: res.status(), run: (await res.json()) as Run };
};
const sentToModel = async (request: APIRequestContext) => (await (await request.get(`${MOCK}/__mock/classified`)).json()) as Record<string, number>;

/** Every mention a run claimed ends in exactly one outcome (counters reconcile). */
function expectReconciled(run: Run) {
  for (const [org, c] of Object.entries(run.orgs ?? {})) {
    expect(c.saved + c.keptCorrection + c.stale + c.retry + c.dead + c.released, `contadores de ${org}`).toBe(c.claimed);
  }
}

async function insertMentions(tag: string, n: number) {
  const texts = Array.from({ length: n }, (_, i) => `Prueba ${tag} número ${i}: bache en la avenida Juárez`);
  const { data, error } = await admin()
    .from("mentions")
    .insert(texts.map((text, i) => ({ org_id: ORG, source_id: SOURCE, external_id: `${tag}-${i}`, text, published_at: new Date().toISOString() })))
    .select("id");
  expect(error).toBeNull();
  return { texts, ids: data!.map((m) => m.id) };
}

test.describe("resiliencia con fallos inyectados", () => {
  test.skip(!process.env.CRON_SECRET || Boolean(process.env.E2E_BASE_URL), "Sólo con el simulador local y CRON_SECRET.");
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);
  test.afterEach(async ({ request }) => {
    await request.delete(`${MOCK}/__mock/faults`);
  });

  test("proveedor caído (529): nada se pierde ni gasta intentos, y al volver se clasifica una vez", async ({ request }) => {
    const db = admin();
    const { texts, ids } = await insertMentions(`caida-${Date.now()}`, 3);
    try {
      await request.post(`${MOCK}/__mock/faults`, { data: { anthropic: { status: 529, times: 50 } } });
      const down = await cron(request);
      expect(down.status).toBe(502);
      expect(down.run.stoppedBy).toMatch(/529|overload/i);
      expectReconciled(down.run);
      const { data: waiting } = await db.from("mentions").select("status, attempts, claim_id, last_error").in("id", ids);
      expect(waiting!.every((m) => m.status === "pending" && m.attempts === 0 && m.claim_id === null)).toBe(true);
      expect(waiting!.every((m) => (m.last_error ?? "").length > 0)).toBe(true);
      // No reservation of the failed calls is left holding budget.
      const { count: held } = await db.from("ai_calls").select("id", { count: "exact", head: true }).eq("org_id", ORG).eq("status", "reserved").lt("expires_at", new Date().toISOString());
      expect(held).toBe(0);

      await request.delete(`${MOCK}/__mock/faults`);
      const back = await cron(request);
      expect(back.status).toBe(200);
      expectReconciled(back.run);
      const { data: rows } = await db.from("mentions").select("status, classifications(id)").in("id", ids);
      expect(rows!.every((r) => r.status === "classified")).toBe(true);
      expect(rows!.every((r) => (Array.isArray(r.classifications) ? r.classifications.length : r.classifications ? 1 : 0) === 1)).toBe(true);
      const sent = await sentToModel(request);
      for (const text of texts) expect(sent[text], text).toBe(1);
    } finally {
      await db.from("mentions").delete().in("id", ids);
    }
  });

  test("tiempo de espera agotado: la corrida se detiene dentro de su presupuesto y libera lo tomado", async ({ request }) => {
    const db = admin();
    const { ids } = await insertMentions(`timeout-${Date.now()}`, 2);
    try {
      // Longer than the 30 s per-call ceiling.
      await request.post(`${MOCK}/__mock/faults`, { data: { anthropic: { delayMs: 40_000 } } });
      const started = Date.now();
      const slow = await cron(request);
      const elapsed = Date.now() - started;
      expect(slow.status).toBe(502);
      expect(elapsed).toBeLessThan(65_000); // maxDuration of the route is 60 s
      expectReconciled(slow.run);
      const { data: waiting } = await db.from("mentions").select("status, attempts, claim_id").in("id", ids);
      expect(waiting!.every((m) => m.status === "pending" && m.attempts === 0 && m.claim_id === null)).toBe(true);

      await request.delete(`${MOCK}/__mock/faults`);
      const back = await cron(request);
      expect(back.status).toBe(200);
      const { data: rows } = await db.from("mentions").select("status").in("id", ids);
      expect(rows!.every((r) => r.status === "classified")).toBe(true);
    } finally {
      await db.from("mentions").delete().in("id", ids);
    }
  });

  test("worker interrumpido: su lease se respeta, al vencer otro la toma y su escritura tardía no cuenta", async ({ request }) => {
    const db = admin();
    const { texts, ids } = await insertMentions(`interrumpido-${Date.now()}`, 1);
    const dead = crypto.randomUUID();
    try {
      // A worker claimed the mention and died (its lease is still running).
      await db.from("mentions").update({ claim_id: dead, claim_expires_at: new Date(Date.now() + 120_000).toISOString(), attempts: 1 }).in("id", ids);
      const during = await cron(request);
      expect(during.status).toBe(200);
      const { data: held } = await db.from("mentions").select("status, claim_id").in("id", ids).single();
      expect(held).toMatchObject({ status: "pending", claim_id: dead });

      // The lease expires: the next run takes it and classifies it once.
      await db.from("mentions").update({ claim_expires_at: new Date(Date.now() - 1000).toISOString() }).in("id", ids);
      const after = await cron(request);
      expect(after.status).toBe(200);
      expectReconciled(after.run);
      const { data: done } = await db.from("mentions").select("status, claim_id, attempts").in("id", ids).single();
      expect(done).toMatchObject({ status: "classified", claim_id: null, attempts: 2 });
      expect((await sentToModel(request))[texts[0]]).toBe(1);

      // The dead worker comes back late and tries to save: nothing is written.
      const late = await db.rpc("complete_classifications", {
        p_claim_id: dead,
        p_results: [{ mention_id: ids[0], sentiment: "negative", confidence: 0.9, emotion: "enojo", topic: "otro", intent: "queja", priority: "low", department_id: null, neighborhood_id: null, model: "worker-muerto" }],
        p_failures: [],
        p_max_attempts: 5,
      });
      expect(late.error).toBeNull();
      expect(late.data).toMatchObject({ saved: 0, stale: 1 });
      const { data: kept } = await db.from("classifications").select("model").eq("mention_id", ids[0]);
      expect(kept).toHaveLength(1);
      expect(kept![0].model).not.toBe("worker-muerto");
    } finally {
      await db.from("mentions").delete().in("id", ids);
    }
  });

  test("una corrección humana no la sobrescribe una reclasificación", async ({ request }) => {
    test.skip(!canCallApiDirectly(), "Necesita la llave publicable.");
    const db = admin();
    const { ids } = await insertMentions(`correccion-${Date.now()}`, 1);
    try {
      expect((await cron(request)).status).toBe(200);
      const { data: model } = await db.from("classifications").select("sentiment, priority").eq("mention_id", ids[0]).single();
      const corrected = model!.sentiment === "positive" ? "negative" : "positive";
      const com = await apiAs(USERS.comunicacion);
      const fix = await com.from("classifications").update({ sentiment: corrected, priority: "high" }).eq("mention_id", ids[0]).select("corrected_at");
      expect(fix.error).toBeNull();
      expect(fix.data![0].corrected_at).not.toBeNull();

      // Something sends it back to the queue (a re-run, a recovered lease): the model answers again.
      await db.from("mentions").update({ status: "pending", attempts: 0 }).in("id", ids);
      const again = await cron(request);
      expect(again.status).toBe(200);
      expect(again.run.orgs?.[ORG]?.keptCorrection ?? 0).toBeGreaterThanOrEqual(1);
      expectReconciled(again.run);
      const { data: after } = await db.from("classifications").select("sentiment, priority, corrected_at").eq("mention_id", ids[0]);
      expect(after).toHaveLength(1);
      expect(after![0]).toMatchObject({ sentiment: corrected, priority: "high" });
      expect(after![0].corrected_at).not.toBeNull();
    } finally {
      await db.from("mentions").delete().in("id", ids);
    }
  });

  test.describe("sobre un caso", () => {
    test.skip(!canCallApiDirectly(), "Necesita la llave publicable.");
    let caseId = "";
    let mentionIds: string[] = [];

    test.beforeEach(async () => {
      const db = admin();
      mentionIds = (await insertMentions(`caso-${Date.now()}`, 1)).ids;
      const created = await db.rpc("create_case", { p_org_id: ORG, p_mention_ids: mentionIds, p_title: "Prueba de resiliencia (e2e)", p_priority: "medium" });
      expect(created.error).toBeNull();
      caseId = created.data as string;
      const com = await apiAs(USERS.comunicacion);
      const assigned = await com.rpc("assign_case", {
        p_case_id: caseId,
        p_department_id: OBRAS,
        p_due_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        p_accept_due_at: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect(assigned.error).toBeNull();
    });

    test.afterEach(async () => {
      const db = admin();
      const { data: files } = await db.storage.from("case-evidence").list(`${ORG}/${caseId}`);
      if (files?.length) await db.storage.from("case-evidence").remove(files.map((f) => `${ORG}/${caseId}/${f.name}`));
      await db.from("tickets").delete().eq("case_id", caseId);
      await db.from("cases").delete().eq("id", caseId);
      await db.from("mentions").delete().in("id", mentionIds);
    });

    test("actualización concurrente: las acciones simultáneas se aplican en orden y ninguna se pierde ni se duplica", async () => {
      const [a, b] = [await apiAs(USERS.obras), await apiAs(USERS.obras)];
      // Two people accept the same case at the same moment while a third call returns it.
      const results = await Promise.all([
        a.rpc("transition_case", { p_case_id: caseId, p_to: "accepted", p_reason: null as unknown as string }),
        b.rpc("transition_case", { p_case_id: caseId, p_to: "accepted", p_reason: null as unknown as string }),
        a.rpc("transition_case", { p_case_id: caseId, p_to: "returned", p_reason: "No es de nuestra competencia (prueba)." }),
      ]);
      const accepted = results.slice(0, 2).filter((r) => !r.error);
      expect(accepted.length).toBeLessThanOrEqual(1);
      const db = admin();
      const { data: events } = await db.from("case_events").select("from_status, to_status").eq("case_id", caseId).not("to_status", "is", null).order("id");
      // At most one acceptance, and each change starts where the previous one ended (row lock, no lost update).
      expect(events!.filter((e) => e.to_status === "accepted").length).toBe(accepted.length);
      for (let i = 1; i < events!.length; i++) expect(events![i].from_status).toBe(events![i - 1].to_status);
      expect(events!.filter((e) => e.to_status === "accepted" || e.to_status === "returned").length).toBe(results.filter((r) => !r.error).length);
      const { data: c } = await db.from("cases").select("status").eq("id", caseId).single();
      expect(c!.status).toBe(events!.at(-1)!.to_status);
    });

    test("Storage rechaza el archivo: el avance no se registra y no quedan archivos huérfanos", async ({ browser }) => {
      const db = admin();
      const obrasApi = await apiAs(USERS.obras);
      for (const to of ["accepted", "in_progress"] as const) {
        expect((await obrasApi.rpc("transition_case", { p_case_id: caseId, p_to: to, p_reason: null as unknown as string })).error).toBeNull();
      }
      const { data: bucket } = await db.storage.getBucket("case-evidence");
      const page = await browser.newPage();
      try {
        // Storage refuses every upload (as if the bucket hit its limit).
        const restricted = await db.storage.updateBucket("case-evidence", { public: false, fileSizeLimit: 1, allowedMimeTypes: bucket!.allowed_mime_types ?? undefined });
        expect(restricted.error).toBeNull();
        await login(page, USERS.obras, `/casos/${caseId}`);
        const main = page.getByRole("main");
        await main.getByLabel("Avance", { exact: true }).fill("Bacheo terminado (prueba de Storage).");
        await main.locator("#case-update-files").setInputFiles([{ name: "bache.png", mimeType: "image/png", buffer: solidPng(64, 48, [90, 90, 90]) }]);
        await main.getByRole("button", { name: "Reportar avance" }).click();
        await expect(toast(page, /No se pudo subir la evidencia/)).toBeVisible();
        // The text the person wrote is still there to retry.
        await expect(main.getByLabel("Avance", { exact: true })).toHaveValue("Bacheo terminado (prueba de Storage).");
        const { count: updates } = await db.from("case_updates").select("id", { count: "exact", head: true }).eq("case_id", caseId);
        expect(updates).toBe(0);
        const { data: orphans } = await db.storage.from("case-evidence").list(`${ORG}/${caseId}`);
        expect(orphans ?? []).toHaveLength(0);

        // Storage is back: the same action goes through once.
        await db.storage.updateBucket("case-evidence", { public: bucket!.public, fileSizeLimit: bucket!.file_size_limit ?? undefined, allowedMimeTypes: bucket!.allowed_mime_types ?? undefined });
        await main.getByRole("button", { name: "Reportar avance" }).click();
        await expect(toast(page, "Avance registrado con 1 archivo.")).toBeVisible();
        const { count: after } = await db.from("case_updates").select("id", { count: "exact", head: true }).eq("case_id", caseId);
        expect(after).toBe(1);
        const { count: evidence } = await db.from("case_evidence").select("id", { count: "exact", head: true }).eq("case_id", caseId);
        expect(evidence).toBe(1);
      } finally {
        await db.storage.updateBucket("case-evidence", { public: bucket!.public, fileSizeLimit: bucket!.file_size_limit ?? undefined, allowedMimeTypes: bucket!.allowed_mime_types ?? undefined });
        await page.close();
      }
    });
  });
});
