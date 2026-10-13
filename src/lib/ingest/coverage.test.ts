import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { metaConnector } from "../connectors/meta.ts";
import { rssConnector } from "../connectors/rss.ts";
import type { Connector, FetchResult, NormalizedMention } from "../connectors/types.ts";
import { youtubeConnector } from "../connectors/youtube.ts";
import { applyResult, BACKFILL_MS, OVERLAP_MS, planWindow, readBackfill, type CoverageState } from "./coverage.ts";

const T0 = Date.parse("2026-10-10T00:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const min = 60_000;

describe("planWindow / applyResult", () => {
  const now = new Date(T0);

  it("starts with a 3-day backfill and reads from the watermark minus the overlap", () => {
    assert.deepEqual(planWindow({ coveredUntil: null, backfill: null }, now), { mode: "head", since: new Date(T0 - BACKFILL_MS - OVERLAP_MS), until: now });
    const plan = planWindow({ coveredUntil: iso(T0 - 60 * min), backfill: null }, now);
    assert.equal(plan.since.toISOString(), iso(T0 - 75 * min));
  });

  it("moves the watermark only when the window is complete", () => {
    const state: CoverageState = { coveredUntil: iso(T0 - 60 * min), backfill: null };
    const plan = planWindow(state, now);
    const done = applyResult(state, plan, { complete: true });
    assert.equal(done.state.coveredUntil, iso(T0));

    const cut = applyResult(state, plan, { complete: false, resumeUntil: iso(T0 - 30 * min) });
    assert.equal(cut.state.coveredUntil, state.coveredUntil, "does not advance over unread items");
    assert.deepEqual(cut.state.backfill, { since: plan.since.toISOString(), until: iso(T0 - 30 * min), coverTo: iso(T0) });
  });

  it("finishes a backfill by jumping to the end of the original window", () => {
    const state: CoverageState = {
      coveredUntil: iso(T0 - 60 * min),
      backfill: { since: iso(T0 - 75 * min), until: iso(T0 - 30 * min), coverTo: iso(T0 - 5 * min) },
    };
    const plan = planWindow(state, now);
    assert.equal(plan.mode, "backfill");
    assert.equal(plan.until.toISOString(), iso(T0 - 30 * min));
    const done = applyResult(state, plan, { complete: true });
    assert.deepEqual(done.state, { coveredUntil: iso(T0 - 5 * min), backfill: null });
  });

  it("skips a stuck same-second tie and reports it", () => {
    const state: CoverageState = { coveredUntil: iso(T0 - 60 * min), backfill: null };
    const plan = planWindow(state, now);
    const stuck = applyResult(state, plan, { complete: false, resumeUntil: iso(T0) });
    assert.equal(stuck.limits[0].kind, "tie");
    assert.equal(stuck.state.backfill?.until, iso(T0 - 1000));
    assert.deepEqual(stuck.gap, { from: iso(T0 - 1000), to: iso(T0) });
  });

  it("reports a provider gap only once the source had coverage", () => {
    const gap = { from: iso(T0 - 60 * min), to: iso(T0 - 10 * min) };
    const plan = planWindow({ coveredUntil: null, backfill: null }, now);
    assert.equal(applyResult({ coveredUntil: null, backfill: null }, plan, { complete: true, gap }).gap, null);
    assert.deepEqual(applyResult({ coveredUntil: iso(T0 - 60 * min), backfill: null }, plan, { complete: true, gap }).gap, gap);
  });
});

// ---------------------------------------------------------------------------
// Several runs against simulated providers, driven exactly like runSource:
// plan → connector → store (dedupe by externalId) → applyResult.
// ---------------------------------------------------------------------------

type Store = Map<string, NormalizedMention>;

function makeSource<C>(connector: Connector<C>, config: C, ctx: Record<string, unknown>) {
  let cursor: Record<string, unknown> = {};
  let state: CoverageState = { coveredUntil: null, backfill: null };
  const store: Store = new Map();
  const runs: { result: FetchResult; gap: unknown; coveredUntil: string | null }[] = [];
  return {
    store,
    runs,
    get state() {
      return state;
    },
    async run(nowMs: number) {
      state = { coveredUntil: state.coveredUntil, backfill: readBackfill(cursor) };
      const plan = planWindow(state, new Date(nowMs));
      const result = await connector.fetchSince({ id: "s", config, cursor }, plan.since, {
        ...ctx,
        now: () => new Date(nowMs),
        until: plan.until,
      });
      for (const m of result.mentions) store.set(m.externalId, m);
      const outcome = applyResult(state, plan, result);
      cursor = { ...cursor, ...(result.cursor ?? {}), backfill: outcome.state.backfill };
      state = outcome.state;
      runs.push({ result, gap: outcome.gap, coveredUntil: state.coveredUntil });
      return { result, outcome };
    },
  };
}

// Graph API stand-in: posts newest first with since/until/limit and offset paging;
// comments oldest first with `after` cursors.
function graph(options: { posts: { id: string; t: number }[]; pageSize: number; failOnce?: number; comments?: Record<string, number> }) {
  let failed = false;
  const fetch: typeof globalThis.fetch = (async (input: string | URL) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v[\d.]+\//, "");
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (path === "Ayto") return json({ id: "1", name: "Ayuntamiento", username: "Ayto" });
    if (path === "1/posts") {
      const since = Number(url.searchParams.get("since")) * 1000;
      const until = Number(url.searchParams.get("until")) * 1000;
      const offset = Number(url.searchParams.get("offset") ?? 0);
      if (options.failOnce === offset && !failed) {
        failed = true;
        return json({ error: { message: "Service temporarily unavailable", code: 2 } }, 500);
      }
      const matching = options.posts.filter((p) => p.t >= since && p.t <= until).sort((a, b) => b.t - a.t);
      const page = matching.slice(offset, offset + options.pageSize);
      const next = offset + options.pageSize < matching.length ? new URL(url) : null;
      next?.searchParams.set("offset", String(offset + options.pageSize));
      return json({
        data: page.map((p) => ({ id: p.id, message: `Publicación ${p.id}`, created_time: iso(p.t) })),
        paging: next ? { next: next.toString() } : {},
      });
    }
    const comments = path.match(/^(.+)\/comments$/);
    if (comments) {
      const total = options.comments?.[comments[1]] ?? 0;
      const after = Number(url.searchParams.get("after") ?? -1);
      const limit = Number(url.searchParams.get("limit"));
      const ids = Array.from({ length: total }, (_, i) => i).filter((i) => i > after).slice(0, limit);
      const last = ids.at(-1) ?? after;
      return json({
        data: ids.map((i) => ({ id: `${comments[1]}_c${i}`, message: `Comentario ${i}`, created_time: iso(T0 + i * 1000) })),
        paging: { cursors: { after: String(last) }, ...(last < total - 1 ? { next: "more" } : {}) },
      });
    }
    return json({ error: { message: `no route ${path}`, code: 100 } }, 400);
  }) as typeof globalThis.fetch;
  return fetch;
}

const metaCtx = (fetch: typeof globalThis.fetch) => ({ fetch, secret: "token", env: { metaGraphVersion: "v23.0" } });
const posts = (n: number, from: number, stepMs: number, prefix = "p") => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, t: from + i * stepMs }));

describe("coverage across runs: Facebook posts", () => {
  it("reads 260 posts over several runs without losing any, and only then moves the watermark", async () => {
    const all = posts(260, T0 - 2 * 86_400_000, 60_000);
    const source = makeSource(metaConnector, { pageId: "Ayto", includeComments: false }, metaCtx(graph({ posts: all, pageSize: 10 })));

    const first = await source.run(T0);
    assert.equal(first.result.complete, false);
    assert.equal(first.result.mentions.length, 100, "10 pages of 10");
    assert.equal(first.result.limits[0].kind, "pages");
    assert.equal(source.state.coveredUntil, null, "watermark not moved over unread posts");

    await source.run(T0 + 60 * min);
    const third = await source.run(T0 + 120 * min);
    assert.equal(third.result.complete, true);
    assert.equal(source.state.coveredUntil, iso(T0), "jumps to the end of the first window");
    assert.equal(source.store.size, 260);

    // Then the head: posts published meanwhile.
    const later = posts(5, T0 + 10 * min, 60_000, "n");
    all.push(...later);
    await source.run(T0 + 180 * min);
    assert.equal(source.store.size, 265);
    assert.equal(source.state.coveredUntil, iso(T0 + 180 * min));
  });

  it("does not lose posts that share a timestamp across a page boundary", async () => {
    // 35 posts in the same second, cut by pages of 10 and a cap of 10 pages.
    const tie = Array.from({ length: 35 }, (_, i) => ({ id: `tie${i}`, t: T0 - 30 * min }));
    const others = posts(150, T0 - 20 * 60 * min, 7 * min, "o");
    const source = makeSource(metaConnector, { pageId: "Ayto", includeComments: false }, metaCtx(graph({ posts: [...tie, ...others], pageSize: 10 })));
    for (let i = 0; i < 6 && !(source.runs.at(-1)?.result.complete ?? false); i++) await source.run(T0 + i * min);
    assert.equal(source.store.size, 185);
    assert.equal(source.runs.every((r) => !r.gap), true, "no gap reported");
  });

  it("reports a same-second tie larger than a run and keeps going", async () => {
    const tie = Array.from({ length: 120 }, (_, i) => ({ id: `t${i}`, t: T0 - 10 * min }));
    const source = makeSource(metaConnector, { pageId: "Ayto", includeComments: false }, metaCtx(graph({ posts: [...tie, ...posts(20, T0 - 50 * min, min, "b")], pageSize: 10 })));
    for (let i = 0; i < 6 && !(source.runs.at(-1)?.result.complete ?? false); i++) await source.run(T0 + i * min);
    assert.equal(source.runs.at(-1)?.result.complete, true, "not stuck");
    assert.ok(source.runs.some((r) => r.result.limits.some((l) => l.kind === "pages")));
    const tieRun = source.runs.find((r) => r.gap);
    assert.ok(tieRun, "the stuck second is reported as a gap");
    assert.ok(source.store.size >= 120, "what fit was kept, and everything outside the second was read");
    for (let i = 0; i < 20; i++) assert.ok(source.store.has(`b${i}`));
  });

  it("keeps what was read when a page fails mid-run and resumes from there", async () => {
    const all = posts(60, T0 - 10 * 60 * min, 7 * min);
    const source = makeSource(metaConnector, { pageId: "Ayto", includeComments: false }, metaCtx(graph({ posts: all, pageSize: 10, failOnce: 30 })));
    const first = await source.run(T0);
    assert.equal(first.result.mentions.length, 30, "three pages read before the failure");
    assert.match(first.result.interruptedBy ?? "", /Meta respondió/);
    assert.equal(source.state.coveredUntil, null);
    const second = await source.run(T0 + min);
    assert.equal(second.result.complete, true);
    assert.equal(source.store.size, 60);
    assert.equal(source.state.coveredUntil, iso(T0));
  });

  it("continues a post's comments from its cursor in the next run", async () => {
    const fetch = graph({ posts: [{ id: "p1", t: T0 - 10 * min }], pageSize: 10, comments: { p1: 650 } });
    const source = makeSource(metaConnector, { pageId: "Ayto", includeComments: true }, metaCtx(fetch));
    const first = await source.run(T0);
    assert.equal(first.result.mentions.filter((m) => m.kind === "comment").length, 500, "5 pages of 100");
    assert.ok(first.result.limits.some((l) => l.kind === "comments"));
    await source.run(T0 + min);
    assert.equal([...source.store.values()].filter((m) => m.kind === "comment").length, 650);
    const third = await source.run(T0 + 2 * min);
    assert.equal(third.result.mentions.filter((m) => m.kind === "comment").length, 0, "nothing re-read once caught up");
  });
});

describe("coverage across runs: YouTube search", () => {
  it("reads 230 videos with 2 search pages per run", async () => {
    const videos = Array.from({ length: 230 }, (_, i) => ({ id: `v${i}`, t: T0 - 1000 * min + i * 4 * min }));
    let searches = 0;
    const fetch: typeof globalThis.fetch = (async (input: string | URL) => {
      const url = new URL(String(input));
      const path = url.pathname.replace("/youtube/v3/", "");
      if (path === "search") {
        searches++;
        const after = Date.parse(url.searchParams.get("publishedAfter")!);
        const before = Date.parse(url.searchParams.get("publishedBefore")!);
        const offset = Number(url.searchParams.get("pageToken") ?? 0);
        const matching = videos.filter((v) => v.t > after && v.t < before).sort((a, b) => b.t - a.t);
        return Response.json({
          items: matching.slice(offset, offset + 50).map((v) => ({ id: { videoId: v.id }, snippet: { title: v.id, publishedAt: iso(v.t) } })),
          nextPageToken: offset + 50 < matching.length ? String(offset + 50) : undefined,
        });
      }
      if (path === "videos") return Response.json({ items: [] });
      return Response.json({ error: { message: "no" } }, { status: 404 });
    }) as typeof globalThis.fetch;
    const source = makeSource(youtubeConnector, { query: "ayuntamiento", includeComments: false }, { fetch, env: { youtubeApiKey: "k" } });
    for (let i = 0; i < 4 && !(source.runs.at(-1)?.result.complete ?? false); i++) await source.run(T0 + i * min);
    assert.equal(source.store.size, 230);
    assert.equal(source.runs.length, 3);
    assert.equal(searches, 5, "2 + 2 + 1 pages: quota spent only on what was missing");
    assert.equal(source.state.coveredUntil, iso(T0));
  });
});

describe("coverage across runs: RSS", () => {
  const item = (id: string, t: number) =>
    `<item><title>Nota ${id}</title><link>https://diario.example/${id}</link><guid>${id}</guid><pubDate>${new Date(t).toUTCString()}</pubDate></item>`;
  const feed = (items: string[]) => `<rss><channel><title>Diario</title>${items.join("")}</channel></rss>`;

  it("returns every item of a 250-item feed (no 200 cap)", async () => {
    const body = feed(Array.from({ length: 250 }, (_, i) => item(`n${i}`, T0 - i * min)));
    const fetch = (async () => new Response(body)) as typeof globalThis.fetch;
    const source = makeSource(rssConnector, { url: "https://diario.example/feed" }, { fetch });
    const run = await source.run(T0);
    assert.equal(run.result.mentions.length, 250);
    assert.equal(run.result.complete, true);
  });

  it("takes items indexed late and reports when the feed rolled past unread items", async () => {
    let items = [item("a", T0 - 120 * min), item("b", T0 - 90 * min)];
    const fetch = (async () => new Response(feed(items))) as typeof globalThis.fetch;
    const source = makeSource(rssConnector, { url: "https://diario.example/feed" }, { fetch });
    await source.run(T0);

    // Next run: a late item dated before the window, and old items still in the feed.
    items = [item("late", T0 - 2 * 86_400_000), ...items];
    const second = await source.run(T0 + 60 * min);
    assert.ok(source.store.has("late"), "late-indexed item within the 7-day tolerance");
    assert.equal(second.outcome.gap, null);

    // A burst pushed everything older out of a 3-item feed.
    items = [item("x1", T0 + 170 * min), item("x2", T0 + 175 * min), item("x3", T0 + 178 * min)];
    const third = await source.run(T0 + 180 * min);
    assert.deepEqual(third.outcome.gap, { from: iso(T0 + 60 * min - OVERLAP_MS), to: iso(T0 + 170 * min) });
    assert.equal(third.result.limits[0].kind, "feed_window");
    assert.equal(source.state.coveredUntil, iso(T0 + 180 * min), "the gap cannot be recovered: reported, not retried");
  });
});
