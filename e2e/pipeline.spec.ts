import { expect, test } from "@playwright/test";
import { admin } from "./helpers";

// Two classification workers at once (two cron calls while the model is slow):
// each mention reaches the model once and is classified once. Needs the local
// simulator and CRON_SECRET (crons do not run on previews).
const MOCK = process.env.E2E_MOCK_URL ?? "http://127.0.0.1:4010";
const ORG = "00000000-0000-4000-a000-000000000001";
const SOURCE = "00000000-0000-4000-e200-000000000002";

test.describe("pipeline de clasificación", () => {
  test("dos workers simultáneos no clasifican la misma mención ni la mandan dos veces a la IA", async ({ request }) => {
    test.skip(!process.env.CRON_SECRET || Boolean(process.env.E2E_BASE_URL), "Sólo con el simulador local y CRON_SECRET.");
    const db = admin();
    const tag = `concurrencia-${Date.now()}`;
    const texts = Array.from({ length: 10 }, (_, i) => `Prueba ${tag} número ${i}: falta agua en la colonia Centro`);
    const { data: inserted, error } = await db
      .from("mentions")
      .insert(texts.map((text, i) => ({ org_id: ORG, source_id: SOURCE, external_id: `${tag}-${i}`, text, published_at: new Date().toISOString() })))
      .select("id");
    expect(error).toBeNull();
    const ids = inserted!.map((m) => m.id);

    try {
      // The model takes 2.5 s per call: both workers are running at the same time.
      await request.post(`${MOCK}/__mock/faults`, { data: { anthropic: { delayMs: 2500 } } });
      const cron = () => request.get("/api/cron/classify", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, timeout: 90_000 });
      const [a, b] = await Promise.all([cron(), cron()]);
      const runs = [await a.json(), await b.json()];

      const sent = (await (await request.get(`${MOCK}/__mock/classified`)).json()) as Record<string, number>;
      for (const text of texts) expect(sent[text], text).toBe(1);

      const { data: rows } = await db.from("mentions").select("status, claim_id, classifications(id)").in("id", ids);
      expect(rows!.every((r) => r.status === "classified" && r.claim_id === null)).toBe(true);
      expect(rows!.every((r) => (Array.isArray(r.classifications) ? r.classifications.length : r.classifications ? 1 : 0) === 1)).toBe(true);

      // Counters per organization, as the database returned them.
      const claimed = runs.reduce((n, r) => n + (r.orgs?.[ORG]?.claimed ?? 0), 0);
      expect(claimed).toBeGreaterThanOrEqual(texts.length);
      const { data: logged } = await db.from("worker_runs").select("run_id, counters").eq("kind", "classify").in("run_id", runs.map((r) => r.runId));
      expect(logged!.reduce((n, r) => n + ((r.counters as { saved?: number }).saved ?? 0), 0)).toBeGreaterThanOrEqual(texts.length);
    } finally {
      await request.delete(`${MOCK}/__mock/faults`);
      await db.from("mentions").delete().in("id", ids);
    }
  });
});
