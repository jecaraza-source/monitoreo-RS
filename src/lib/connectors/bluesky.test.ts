import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blueskyConfigSchema, blueskyConnector, postUrl } from "./bluesky.ts";

const now = () => new Date("2026-10-28T15:00:00Z");
const since = new Date("2026-10-28T00:00:00Z");
const env = { blueskyIdentifier: "radar.alvarado.gob.mx", blueskyAppPassword: "app-pass", blueskyService: "https://pds.test" };

type Call = { url: URL; init?: RequestInit };
function bsFetch(handler: (path: string, url: URL, init?: RequestInit) => { status?: number; body: unknown }, calls: Call[]) {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const { status = 200, body } = handler(url.pathname.replace("/xrpc/", ""), url, init);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

const post = (rkey: string, did: string, handle: string, text: string, createdAt: string) => ({
  uri: `at://${did}/app.bsky.feed.post/${rkey}`,
  author: { did, handle, displayName: handle === "noticias.bsky.social" ? "Noticias del Golfo" : "Vecina" },
  record: { text, createdAt },
  indexedAt: createdAt,
  likeCount: 3,
  repostCount: 1,
  quoteCount: 1,
  replyCount: 2,
});

const handler = (path: string, url: URL) => {
  if (path === "com.atproto.server.createSession") return { body: { accessJwt: "jwt-1", did: "did:plc:radar" } };
  if (path === "app.bsky.feed.searchPosts") {
    if (url.searchParams.get("cursor") === "p2") return { body: { posts: [post("old", "did:plc:v", "vecina.bsky.social", "Viejo", "2026-10-27T10:00:00Z")] } };
    return {
      body: {
        posts: [
          post("a1", "did:plc:media", "noticias.bsky.social", "Cortes de agua en Alvarado", "2026-10-28T10:00:00Z"),
          post("a2", "did:plc:v", "vecina.bsky.social", "En mi colonia no hay agua", "2026-10-28T09:00:00Z"),
        ],
        cursor: "p2",
      },
    };
  }
  if (path === "app.bsky.feed.getAuthorFeed")
    return {
      body: {
        feed: [
          { post: post("f1", "did:plc:media", "noticias.bsky.social", "Nota propia", "2026-10-28T11:00:00Z") },
          { post: post("rp", "did:plc:other", "otro.bsky.social", "Repost ajeno", "2026-10-28T11:30:00Z"), reason: { $type: "app.bsky.feed.defs#reasonRepost" } },
          { post: post("f0", "did:plc:media", "noticias.bsky.social", "Anterior", "2026-10-27T20:00:00Z") },
        ],
      },
    };
  return { status: 404, body: { error: "NotFound" } };
};

describe("blueskyConnector", () => {
  it("signs in with the app password and searches newest first within the window", async () => {
    const calls: Call[] = [];
    const result = await blueskyConnector.fetchSince({ id: "s", config: blueskyConfigSchema.parse({ query: "Alvarado agua" }), cursor: {} }, since, {
      fetch: bsFetch(handler, calls),
      env,
      now,
    });
    assert.equal(calls[0].url.toString(), "https://pds.test/xrpc/com.atproto.server.createSession");
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { identifier: "radar.alvarado.gob.mx", password: "app-pass" });
    const search = calls[1];
    assert.equal(search.url.searchParams.get("q"), "Alvarado agua");
    assert.equal(search.url.searchParams.get("sort"), "latest");
    assert.equal(search.url.searchParams.get("since"), since.toISOString());
    assert.equal((search.init?.headers as Record<string, string>).authorization, "Bearer jwt-1");
    assert.equal(result.complete, true);
    assert.deepEqual(result.mentions.map((m) => m.externalId), ["at://did:plc:media/app.bsky.feed.post/a1", "at://did:plc:v/app.bsky.feed.post/a2"]);
    assert.equal(result.mentions[0].url, "https://bsky.app/profile/did:plc:media/post/a1");
    assert.deepEqual(result.mentions[0].metrics, { likes: 3, shares: 2, comments: 2 });
    // Found by an open search: not vouched, no display name.
    assert.deepEqual(result.mentions[1].author, { platform: "bluesky", handle: "vecina.bsky.social", displayName: null, followers: null, kind: null, vouched: false });
  });

  it("an account without a search reads its own feed, vouched, without reposts", async () => {
    const result = await blueskyConnector.fetchSince(
      { id: "s", config: blueskyConfigSchema.parse({ account: "@Noticias.bsky.social" }), cursor: {} },
      since,
      { fetch: bsFetch(handler, []), env, now },
    );
    assert.deepEqual(result.mentions.map((m) => m.text), ["Nota propia"]);
    assert.deepEqual(result.mentions[0].author, {
      platform: "bluesky",
      handle: "noticias.bsky.social",
      displayName: "Noticias del Golfo",
      followers: null,
      kind: "media",
      vouched: true,
    });
  });

  it("explains missing or rejected credentials", async () => {
    await assert.rejects(
      blueskyConnector.fetchSince({ id: "s", config: { query: "x" }, cursor: {} }, since, { fetch: bsFetch(handler, []), env: {}, now }),
      /Falta configurar BLUESKY_IDENTIFIER/,
    );
    const denied = bsFetch(() => ({ status: 401, body: { error: "AuthenticationRequired", message: "Invalid identifier or password" } }), []);
    await assert.rejects(blueskyConnector.fetchSince({ id: "s", config: { query: "x" }, cursor: {} }, since, { fetch: denied, env, now }), /rechazó la cuenta/);
  });

  it("validates the configuration and builds post links", () => {
    assert.equal(blueskyConfigSchema.safeParse({}).success, false);
    assert.equal(blueskyConfigSchema.safeParse({ account: "no es cuenta" }).success, false);
    assert.equal(postUrl("at://did:plc:x/app.bsky.feed.post/3k", "did:plc:x"), "https://bsky.app/profile/did:plc:x/post/3k");
    assert.equal(postUrl("at://did:plc:x/app.bsky.feed.like/3k", "did:plc:x"), null);
  });
});
