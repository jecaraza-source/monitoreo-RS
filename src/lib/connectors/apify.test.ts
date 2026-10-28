import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apifyConfigSchema, apifyConnector, itemDate, toMention } from "./apify.ts";

const now = () => new Date("2026-10-28T15:00:00Z");
const since = new Date("2026-10-28T00:00:00Z");
const env = { apifyToken: "tok", apifyApiUrl: "https://apify.test" };

function apifyFetch(items: unknown, run: { status?: number; body?: unknown } = {}, calls: URL[] = []) {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url);
    if (new Headers(init?.headers).get("authorization") !== "Bearer tok") return new Response("{}", { status: 401 });
    if (url.pathname.includes("/runs/last")) {
      return new Response(JSON.stringify(run.body ?? { data: { id: "r1", status: "SUCCEEDED", finishedAt: "2026-10-28T12:00:00Z", defaultDatasetId: "ds1" } }), {
        status: run.status ?? 200,
      });
    }
    return new Response(JSON.stringify(items), { status: 200 });
  }) as typeof fetch;
}

const source = (config = { task: "yo~ig-medios", network: "instagram" as const }) => ({ id: "s1", cursor: {}, config });

describe("apifyConfigSchema", () => {
  it("accepts user~task and user/task, and requires the network", () => {
    assert.equal(apifyConfigSchema.parse({ task: " yo/ig-medios ", network: "instagram" }).task, "yo~ig-medios");
    assert.equal(apifyConfigSchema.safeParse({ task: "../../acts", network: "instagram" }).success, false);
    assert.equal(apifyConfigSchema.safeParse({ task: "yo~ig" }).success, false);
  });
});

describe("item mapping", () => {
  it("reads the common fields of Instagram, TikTok, X and Facebook actors", () => {
    const at = now();
    const ig = toMention({ id: "1", caption: "Baches en <b>Alvarado</b>", url: "https://www.instagram.com/p/x/", timestamp: "2026-10-28T10:00:00.000Z", likesCount: 5, commentsCount: 2, ownerUsername: "vecino" }, at)!;
    assert.equal(ig.text, "Baches en Alvarado");
    assert.equal(ig.externalId, "id:1");
    assert.deepEqual(ig.metrics, { likes: 5, comments: 2 });
    assert.equal(ig.author, null, "authors are never stored");
    const tt = toMention({ id: "7", text: "Video", webVideoUrl: "https://www.tiktok.com/@a/video/7", createTime: 1793181600, diggCount: 9, shareCount: 1, playCount: 100 }, at)!;
    assert.equal(tt.publishedAt, "2026-10-28T10:00:00.000Z");
    assert.deepEqual(tt.metrics, { likes: 9, shares: 1, views: 100 });
    assert.equal(itemDate({ createdAt: "Wed Oct 28 10:00:00 +0000 2026" })?.toISOString(), "2026-10-28T10:00:00.000Z");
    assert.equal(toMention({ id: "x", url: "javascript:alert(1)", text: "a" }, at)!.url, null);
    assert.equal(toMention({ id: "x", likes: 3 }, at), null, "no text, no mention");
  });
});

describe("apifyConnector.fetchSince", () => {
  it("reads the latest successful run and keeps the window", async () => {
    const calls: URL[] = [];
    const items = [
      { id: "new", text: "Futuro", timestamp: "2026-10-28T16:00:00Z" },
      { id: "a", text: "Agua en Alvarado", timestamp: "2026-10-28T10:00:00Z" },
      { id: "late", text: "Tardía", timestamp: "2026-10-25T10:00:00Z" },
      { id: "old", text: "Vieja", timestamp: "2026-10-01T10:00:00Z" },
    ];
    const r = await apifyConnector.fetchSince(source(), since, { fetch: apifyFetch(items, {}, calls), now, env });
    assert.deepEqual(r.mentions.map((m) => m.externalId), ["id:a", "id:late"]);
    assert.equal(r.complete, true);
    assert.equal(r.gap, undefined);
    assert.equal(calls[0].pathname, "/v2/actor-tasks/yo~ig-medios/runs/last");
    assert.equal(calls[0].searchParams.get("status"), "SUCCEEDED");
    assert.equal(calls[1].pathname, "/v2/datasets/ds1/items");
  });

  it("reports a stale task and a run that rolled past the window", async () => {
    const run = { body: { data: { finishedAt: "2026-10-20T00:00:00Z", defaultDatasetId: "ds1" } } };
    const r = await apifyConnector.fetchSince(source(), new Date("2026-10-27T00:00:00Z"), {
      fetch: apifyFetch([{ id: "a", text: "Hoy", timestamp: "2026-10-28T10:00:00Z" }], run),
      now,
      env,
    });
    assert.ok(r.limits.some((l) => /hace 8 días/.test(l.detail)));
    assert.equal(r.gap?.to, "2026-10-28T10:00:00.000Z");
  });

  it("explains missing tokens, rejected tokens and unknown tasks", async () => {
    await assert.rejects(apifyConnector.fetchSince(source(), since, { now, env: {} }), /APIFY_TOKEN/);
    await assert.rejects(apifyConnector.fetchSince(source(), since, { fetch: apifyFetch([]), now, env: { ...env, apifyToken: "otro" } }), /rechazó APIFY_TOKEN/);
    await assert.rejects(
      apifyConnector.fetchSince(source(), since, { fetch: apifyFetch([], { status: 404, body: { error: { type: "record-not-found" } } }), now, env }),
      /no existe en Apify/,
    );
  });
});
