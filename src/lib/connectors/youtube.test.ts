import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { youtubeConnector } from "./youtube.ts";

function ytFetch(handler: (path: string, url: URL) => { status?: number; body: unknown }, calls: URL[]) {
  return (async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    const { status = 200, body } = handler(url.pathname.replace("/youtube/v3/", ""), url);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

const now = () => new Date("2026-10-09T15:00:00Z");
const since = new Date("2026-10-09T00:00:00Z");
const env = { youtubeApiKey: "yt-key" };

const handler = (path: string, url: URL) => {
  if (path === "search")
    return {
      body: {
        items: [
          {
            id: { videoId: "vid1" },
            snippet: {
              title: "Informe del ayuntamiento &amp; obras",
              description: "Resumen de obras en San Andrés",
              publishedAt: "2026-10-09T10:00:00Z",
              channelId: "UCabcdefghijklmnopqrstuv",
              channelTitle: "TV Regional",
            },
          },
        ],
      },
    };
  if (path === "videos") return { body: { items: [{ id: "vid1", statistics: { viewCount: "1500", likeCount: "40", commentCount: "2" } }] } };
  if (path === "commentThreads") {
    const videoId = url.searchParams.get("videoId");
    if (videoId === "vidNoComments")
      return { status: 403, body: { error: { code: 403, message: "disabled", errors: [{ reason: "commentsDisabled" }] } } };
    return {
      body: {
        items: [
          { id: "t2", snippet: { topLevelComment: { id: "c2", snippet: { textOriginal: "Faltan luminarias", publishedAt: "2026-10-09T12:00:00Z", likeCount: 5 } } } },
          { id: "t1", snippet: { topLevelComment: { id: "c1", snippet: { textOriginal: "Viejo", publishedAt: "2026-10-08T12:00:00Z" } } } },
        ],
      },
    };
  }
  return { status: 404, body: { error: { message: "no route" } } };
};

describe("youtubeConnector", () => {
  it("returns videos with stats and new comments; skips videos with comments disabled", async () => {
    const calls: URL[] = [];
    const result = await youtubeConnector.fetchSince(
      {
        id: "s",
        config: { query: "San Andrés ayuntamiento", includeComments: true },
        cursor: { recentVideos: [{ id: "vidNoComments", publishedAt: "2026-10-08T00:00:00Z" }] },
      },
      since,
      { fetch: ytFetch(handler, calls), env, now },
    );
    assert.deepEqual(result.mentions.map((m) => m.externalId), ["video:vid1", "comment:c2"]);
    const [video, comment] = result.mentions;
    assert.equal(video.text, "Informe del ayuntamiento & obras — Resumen de obras en San Andrés");
    assert.deepEqual(video.metrics, { views: 1500, likes: 40, comments: 2 });
    assert.equal(video.author?.displayName, "TV Regional");
    assert.equal(comment.author, null);
    assert.equal(comment.url, "https://www.youtube.com/watch?v=vid1&lc=c2");

    const search = calls[0];
    assert.equal(search.searchParams.get("publishedAfter"), since.toISOString());
    assert.equal(search.searchParams.get("q"), "San Andrés ayuntamiento");
    assert.equal(search.searchParams.get("key"), "yt-key");
    assert.equal(calls.filter((c) => c.pathname.endsWith("/search")).length, 1, "one 100-unit search per run");
  });

  it("explains an exhausted quota", async () => {
    const quota = ytFetch(() => ({ status: 403, body: { error: { code: 403, errors: [{ reason: "quotaExceeded" }] } } }), []);
    await assert.rejects(
      youtubeConnector.fetchSince({ id: "s", config: { query: "x", includeComments: false }, cursor: {} }, since, { fetch: quota, env, now }),
      /cuota diaria/,
    );
  });

  it("needs the API key and a query or channel", async () => {
    await assert.rejects(
      youtubeConnector.fetchSince({ id: "s", config: { query: "x", includeComments: false }, cursor: {} }, since, { fetch: ytFetch(handler, []), env: {}, now }),
      /YOUTUBE_API_KEY/,
    );
    assert.equal(youtubeConnector.configSchema.safeParse({ includeComments: true }).success, false);
    assert.equal(youtubeConnector.configSchema.safeParse({ channelId: "UCabcdefghijklmnopqrstuv" }).success, true);
    assert.equal(youtubeConnector.configSchema.safeParse({ channelId: "bad" }).success, false);
  });
});
