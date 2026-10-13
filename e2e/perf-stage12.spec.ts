import { expect, test, type APIRequestContext } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { admin, apiAs, login, USERS } from "./helpers";

// Stage 12 measurements: capture, classification, inbox, map and reports with
// a representative volume. Off by default and LOCAL ONLY: load
// supabase/perf/map_scale.sql first, then run with PERF=1 (one worker).
// The model is the local simulator, so classification and report times
// measure the system without the provider's latency (a run with a simulated
// 1.5 s per call is included). Results: test-results/perf-stage12.json.
const MOCK = process.env.E2E_MOCK_URL ?? "http://127.0.0.1:4010";
const ORG = "00000000-0000-4000-a000-000000000001";
const RUNS = Number(process.env.PERF_RUNS ?? 7);

type Stat = { name: string; unit: string; n: number; median: number; p95: number; min: number; max: number; note?: string };
const results: Stat[] = [];

function record(name: string, values: number[], unit = "ms", note?: string) {
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
  const stat = { name, unit, n: s.length, median: at(0.5), p95: at(0.95), min: s[0], max: s.at(-1)!, note };
  results.push(stat);
  console.log(`${name}: mediana ${stat.median} ${unit}, p95 ${stat.p95} ${unit} (n=${stat.n}, ${stat.min}–${stat.max})${note ? ` · ${note}` : ""}`);
}

const timed = async <T>(fn: () => PromiseLike<T>) => {
  const t0 = performance.now();
  const value = await fn();
  return { ms: Math.round(performance.now() - t0), value };
};
const cron = (request: APIRequestContext) => request.get("/api/cron/classify", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, timeout: 120_000 });

test.describe("mediciones de la etapa 12", () => {
  test.skip(!process.env.PERF || Boolean(process.env.E2E_BASE_URL), "Medición manual local: PERF=1 con supabase/perf/map_scale.sql cargado.");
  test.describe.configure({ mode: "serial" });
  test.setTimeout(600_000);

  test.afterAll(async () => {
    const db = admin();
    const volume = Object.fromEntries(
      await Promise.all(
        (["mentions", "classifications", "cases", "neighborhoods", "case_events"] as const).map(async (t) => [t, (await db.from(t).select("*", { count: "exact", head: true }).eq("org_id", ORG)).count]),
      ),
    );
    writeFileSync("test-results/perf-stage12.json", JSON.stringify({ at: new Date().toISOString(), runs: RUNS, volume, results }, null, 2));
    console.log("Volumen:", JSON.stringify(volume));
  });

  test("captura: lotes de 500 menciones por la RPC de ingesta", async () => {
    const db = admin();
    const { data: source } = await db.from("sources").insert({ org_id: ORG, name: "Perf captura", type: "rss", config: { url: "https://example.com/perf.xml" }, is_active: false }).select("id").single();
    try {
      const times: number[] = [];
      for (let r = 0; r < RUNS; r++) {
        const rows = Array.from({ length: 500 }, (_, i) => ({ external_id: `perf-cap-${Date.now()}-${r}-${i}`, url: `https://example.com/p/${r}/${i}`, text: `Mención de captura ${r}-${i}: fuga en la colonia Centro`, published_at: new Date().toISOString(), author_id: null, metrics: {}, query_id: null }));
        const { ms, value } = await timed(() => db.rpc("ingest_mentions", { p_org_id: ORG, p_source_id: source!.id, p_rows: rows }));
        expect(value.error).toBeNull();
        times.push(ms);
      }
      record("captura (500 menciones por lote)", times, "ms", `≈ ${Math.round((500 * 1000) / times.sort((a, b) => a - b)[Math.floor(times.length / 2)])} menciones/s`);
    } finally {
      await db.from("mentions").delete().eq("source_id", source!.id);
      await db.from("sources").delete().eq("id", source!.id);
    }
  });

  test("clasificación: 200 menciones con uno y dos workers, y con latencia simulada", async ({ request }) => {
    const db = admin();
    const { data: source } = await db.from("sources").insert({ org_id: ORG, name: "Perf clasificación", type: "rss", config: { url: "https://example.com/perf2.xml" }, is_active: false }).select("id").single();
    const insert = async (n: number, tag: string) => {
      const rows = Array.from({ length: n }, (_, i) => ({ org_id: ORG, source_id: source!.id, external_id: `${tag}-${i}`, text: `Prueba ${tag} ${i}: lámpara fundida en San Miguel`, published_at: new Date().toISOString() }));
      expect((await db.from("mentions").insert(rows)).error).toBeNull();
    };
    const pending = async () => (await db.from("mentions").select("id", { count: "exact", head: true }).eq("source_id", source!.id).eq("status", "pending")).count ?? 0;
    try {
      const one: number[] = [];
      const two: number[] = [];
      for (let r = 0; r < 3; r++) {
        await insert(200, `perf-c1-${Date.now()}-${r}`);
        let { ms } = await timed(async () => {
          while ((await pending()) > 0) expect((await cron(request)).status()).toBe(200);
        });
        one.push(ms);
        await insert(200, `perf-c2-${Date.now()}-${r}`);
        ({ ms } = await timed(async () => {
          while ((await pending()) > 0) await Promise.all([cron(request), cron(request)]);
        }));
        two.push(ms);
      }
      record("clasificación de 200 menciones, 1 worker (modelo simulado sin latencia)", one);
      record("clasificación de 200 menciones, 2 workers simultáneos (modelo simulado sin latencia)", two);
      await request.post(`${MOCK}/__mock/faults`, { data: { anthropic: { delayMs: 1500 } } });
      await insert(80, `perf-c3-${Date.now()}`);
      const slow: number[] = [];
      for (let r = 0; r < 1; r++) {
        const { ms } = await timed(async () => {
          while ((await pending()) > 0) expect((await cron(request)).status()).toBe(200);
        });
        slow.push(ms);
      }
      record("clasificación de 80 menciones con 1.5 s simulados por llamada", slow, "ms", "una corrida");
    } finally {
      await request.delete(`${MOCK}/__mock/faults`);
      await db.from("mentions").delete().eq("source_id", source!.id);
      await db.from("sources").delete().eq("id", source!.id);
    }
  });

  for (const [name, url, ready] of [
    ["bandeja", "/bandeja", "live"],
    ["mapa: casos 30 días", "/mapa?periodo=30d&capa=casos", "map"],
    ["mapa: conversación 30 días", "/mapa?periodo=30d", "map"],
    ["dashboard", "/dashboard", "load"],
    ["reportes (lista)", "/reportes", "load"],
  ] as const) {
    test(`página: ${name}`, async ({ page }) => {
      await login(page, USERS.comunicacion, "/preferencias");
      const server: number[] = [];
      const visible: number[] = [];
      let kb = 0;
      for (let r = 0; r < RUNS; r++) {
        const { ms, value } = await timed(() => page.request.get(url));
        expect(value.status()).toBe(200);
        kb = Math.round((await value.body()).length / 1024);
        server.push(ms);
        const t1 = performance.now();
        await page.goto(url, { waitUntil: "load" });
        if (ready === "map") await page.locator(".maplibregl-canvas").waitFor();
        if (ready === "live") await page.getByText("En vivo", { exact: true }).waitFor({ timeout: 30_000 });
        visible.push(Math.round(performance.now() - t1));
      }
      record(`${name}: respuesta del servidor`, server, "ms", `${kb} kB`);
      record(`${name}: hasta visible en el navegador`, visible);
      // 10 people opening it at the same time.
      const burst = await Promise.all(Array.from({ length: 10 }, () => timed(() => page.request.get(url))));
      expect(burst.every((b) => b.value.status() === 200)).toBe(true);
      record(`${name}: 10 solicitudes simultáneas`, burst.map((b) => b.ms));
    });
  }

  test("reportes: indicadores del periodo y borrador completo", async ({ page }) => {
    const com = await apiAs(USERS.comunicacion);
    const day = 86_400_000;
    const kpi: number[] = [];
    for (let r = 0; r < RUNS; r++) {
      const now = Date.now();
      const { ms, value } = await timed(() =>
        com.rpc("kpi_snapshot", { p_org_id: ORG, p_from: new Date(now - 30 * day).toISOString(), p_to: new Date(now).toISOString(), p_prev_from: new Date(now - 60 * day).toISOString(), p_prev_to: new Date(now - 30 * day).toISOString(), p_bucket: "day" }),
      );
      expect(value.error).toBeNull();
      kpi.push(ms);
    }
    record("indicadores de 30 días (kpi_snapshot)", kpi);

    const db = admin();
    const created: string[] = [];
    try {
      await login(page, USERS.comunicacion, "/reportes");
      const drafts: number[] = [];
      for (let r = 0; r < 3; r++) {
        await page.goto("/reportes");
        await page.getByRole("button", { name: "Generar reporte" }).click();
        await expect(page.getByRole("dialog").getByText(/^Periodo:/)).toBeVisible();
        const { ms } = await timed(async () => {
          await page.getByRole("button", { name: "Generar borrador" }).click();
          await page.waitForURL(/\/reportes\/[0-9a-f-]{36}$/, { timeout: 120_000 });
          await page.getByRole("heading", { name: "Narrativa" }).waitFor();
        });
        created.push(page.url().split("/").pop()!);
        drafts.push(ms);
      }
      record("borrador de reporte (datos + narrativa simulada)", drafts);
    } finally {
      if (created.length) await db.from("reports").delete().in("id", created);
    }
  });
});
