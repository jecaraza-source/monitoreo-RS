import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redditConfigSchema, redditConnector } from "./reddit.ts";

const now = () => new Date("2026-10-28T15:00:00Z");
const since = new Date("2026-10-28T00:00:00Z");
const env = { redditClientId: "cid", redditClientSecret: "csecret", redditAuthUrl: "https://auth.test/token", redditApiUrl: "https://api.test" };
const t = (iso: string) => Date.parse(iso) / 1000;

type Call = { url: URL; init?: RequestInit };
function rdFetch(handler: (url: URL, init?: RequestInit) => { status?: number; body: unknown }, calls: Call[]) {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const { status = 200, body } = handler(url, init);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

const child = (id: string, title: string, created: string, extra: Record<string, unknown> = {}) => ({
  kind: "t3",
  data: { id, name: `t3_${id}`, title, selftext: "", created_utc: t(created), permalink: `/r/veracruz/comments/${id}/x/`, author: "usuario_x", score: 7, num_comments: 3, ...extra },
});

const handler = (url: URL) => {
  if (url.host === "auth.test") return { body: { access_token: "tok", token_type: "bearer", expires_in: 86400 } };
  if (url.searchParams.get("after") === "t3_b") return { body: { data: { children: [child("old", "Viejo", "2026-10-27T10:00:00Z")], after: null } } };
  return {
    body: {
      data: {
        children: [
          child("z", "Futuro", "2026-10-28T16:00:00Z"),
          child("a", "Baches en Alvarado", "2026-10-28T10:00:00Z", { selftext: "Llevan meses" }),
          child("n", "NSFW", "2026-10-28T09:30:00Z", { over_18: true }),
          child("b", "Agua en Alvarado", "2026-10-28T09:00:00Z"),
        ],
        after: "t3_b",
      },
    },
  };
};

describe("redditConnector", () => {
  it("gets an app-only token and searches a subreddit, newest first", async () => {
    const calls: Call[] = [];
    const result = await redditConnector.fetchSince(
      { id: "s", config: redditConfigSchema.parse({ query: "Alvarado", subreddit: "r/veracruz" }), cursor: {} },
      since,
      { fetch: rdFetch(handler, calls), env, now },
    );
    const token = calls[0];
    assert.equal(token.init?.method, "POST");
    assert.equal(String(token.init?.body), "grant_type=client_credentials");
    assert.equal((token.init?.headers as Record<string, string>).authorization, `Basic ${Buffer.from("cid:csecret").toString("base64")}`);
    const search = calls[1].url;
    assert.equal(search.pathname, "/r/veracruz/search");
    assert.equal(search.searchParams.get("restrict_sr"), "1");
    assert.equal(search.searchParams.get("sort"), "new");
    assert.match((calls[1].init?.headers as Record<string, string>)["user-agent"], /sigma-pulso/);
    // Newer than the window end and NSFW are left out; the page past `since` ends the read.
    assert.deepEqual(result.mentions.map((m) => m.externalId), ["t3_a", "t3_b"]);
    assert.equal(result.complete, true);
    assert.equal(result.mentions[0].text.includes("Llevan meses"), true);
    assert.equal(result.mentions[0].url, "https://www.reddit.com/r/veracruz/comments/a/x/");
    assert.equal(result.mentions[0].author, null);
    assert.deepEqual(result.mentions[0].metrics, { likes: 7, comments: 3 });
  });

  it("a subreddit without a search reads its newest posts", async () => {
    const calls: Call[] = [];
    await redditConnector.fetchSince({ id: "s", config: redditConfigSchema.parse({ subreddit: "veracruz" }), cursor: {} }, since, {
      fetch: rdFetch(handler, calls),
      env,
      now,
    });
    assert.equal(calls[1].url.pathname, "/r/veracruz/new");
    assert.equal(calls[1].url.searchParams.get("q"), null);
  });

  it("explains missing or rejected credentials and validates the configuration", async () => {
    await assert.rejects(
      redditConnector.fetchSince({ id: "s", config: { query: "x" }, cursor: {} }, since, { fetch: rdFetch(handler, []), env: {}, now }),
      /Falta configurar REDDIT_CLIENT_ID/,
    );
    const denied = rdFetch(() => ({ status: 401, body: { error: "invalid_client" } }), []);
    await assert.rejects(redditConnector.fetchSince({ id: "s", config: { query: "x" }, cursor: {} }, since, { fetch: denied, env, now }), /rechazó REDDIT_CLIENT_ID/);
    assert.equal(redditConfigSchema.safeParse({}).success, false);
    assert.equal(redditConfigSchema.safeParse({ subreddit: "no válido!" }).success, false);
  });
});
