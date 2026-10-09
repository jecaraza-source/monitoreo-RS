import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { metaConnector } from "./meta.ts";

type Route = (url: URL) => unknown;

function graphFetch(routes: Record<string, Route>, calls: URL[]) {
  return (async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    const path = url.pathname.replace(/^\/v[\d.]+\//, "");
    const route = routes[path];
    const body = route ? route(url) : { error: { message: `no route ${path}`, code: 100 } };
    return new Response(JSON.stringify(body), { status: (body as { error?: unknown }).error ? 400 : 200 });
  }) as typeof fetch;
}

const now = () => new Date("2026-10-09T15:00:00Z");
const since = new Date("2026-10-09T00:00:00Z");
const env = { metaAppSecret: "app-secret", metaGraphVersion: "v23.0" };
const config = { pageId: "AyuntamientoSA", includeComments: true };

const routes: Record<string, Route> = {
  AyuntamientoSA: () => ({ id: "123", name: "Ayuntamiento de San Andrés", username: "AyuntamientoSA", followers_count: 5000 }),
  "123/posts": (url) =>
    url.searchParams.get("after")
      ? { data: [{ id: "123_2", message: "Segundo post", created_time: "2026-10-09T09:00:00+0000" }] }
      : {
          data: [
            {
              id: "123_1",
              message: "Iniciamos el bacheo en Centro",
              created_time: "2026-10-09T10:00:00+0000",
              permalink_url: "https://facebook.com/123_1",
              shares: { count: 4 },
              reactions: { summary: { total_count: 30 } },
              comments: { summary: { total_count: 2 } },
            },
            { id: "123_photo", created_time: "2026-10-09T08:00:00+0000" }, // no message
          ],
          paging: { next: "https://graph.facebook.com/v23.0/123/posts?after=abc&access_token=page-token" },
        },
  "123_1/comments": () => ({
    data: [
      { id: "c2", message: "¡Por fin!", created_time: "2026-10-09T11:00:00+0000", like_count: 3 },
      { id: "c1", message: "Viejo", created_time: "2026-10-08T11:00:00+0000" },
    ],
  }),
  "123_2/comments": () => ({ data: [] }),
  "123_photo/comments": () => ({ data: [] }),
  "999_old/comments": () => ({ data: [{ id: "c9", message: "Comentario en post anterior", created_time: "2026-10-09T12:00:00+0000" }] }),
};

describe("metaConnector", () => {
  it("reads page posts and comments with the page token and appsecret_proof", async () => {
    const calls: URL[] = [];
    const cursor = { recentPosts: [{ id: "999_old", publishedAt: "2026-10-07T00:00:00+0000" }] };
    const result = await metaConnector.fetchSince({ id: "s", config, cursor }, since, {
      fetch: graphFetch(routes, calls),
      secret: "page-token",
      env,
      now,
    });

    assert.deepEqual(
      result.mentions.map((m) => `${m.kind}:${m.externalId}`),
      ["post:123_1", "post:123_2", "comment:c2", "comment:c9"],
    );
    const [post] = result.mentions;
    assert.deepEqual(post.metrics, { likes: 30, shares: 4, comments: 2 });
    assert.equal(post.author?.displayName, "Ayuntamiento de San Andrés");
    assert.equal(post.author?.kind, "public_figure");
    assert.equal(result.mentions[2].author, null, "commenters are not stored");

    const first = calls[0];
    assert.equal(first.searchParams.get("access_token"), "page-token");
    assert.equal(
      first.searchParams.get("appsecret_proof"),
      createHmac("sha256", "app-secret").update("page-token").digest("hex"),
    );
    const postsCall = calls.find((c) => c.pathname.endsWith("/123/posts"))!;
    assert.equal(postsCall.searchParams.get("since"), String(since.getTime() / 1000));

    // Posts seen this run are remembered so their later comments get polled.
    const ids = (result.cursor?.recentPosts as { id: string }[]).map((p) => p.id);
    assert.deepEqual(ids.sort(), ["123_1", "123_2", "123_photo", "999_old"].sort());
  });

  it("can skip comments", async () => {
    const calls: URL[] = [];
    const result = await metaConnector.fetchSince(
      { id: "s", config: { ...config, includeComments: false }, cursor: {} },
      since,
      { fetch: graphFetch(routes, calls), secret: "page-token", env, now },
    );
    assert.equal(result.mentions.every((m) => m.kind === "post"), true);
    assert.equal(calls.some((c) => c.pathname.endsWith("/comments")), false);
  });

  it("explains an expired token", async () => {
    const expired = graphFetch({ AyuntamientoSA: () => ({ error: { message: "Session expired", code: 190 } }) }, []);
    await assert.rejects(
      metaConnector.fetchSince({ id: "s", config, cursor: {} }, since, { fetch: expired, secret: "t", env, now }),
      /token de la página expiró/,
    );
  });

  it("requires a token", async () => {
    await assert.rejects(
      metaConnector.fetchSince({ id: "s", config, cursor: {} }, since, { fetch: graphFetch(routes, []), env, now }),
      /Falta el token/,
    );
  });
});
