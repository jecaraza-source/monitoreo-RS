// YouTube Data API v3 connector: videos found by a search and/or a channel,
// plus comments on recent ones. Uses the server-wide YOUTUBE_API_KEY.
import { z } from "zod";
import { fetchJson, redactUrl } from "./http.ts";
import { mergeRecent, readRecent, type RecentItem } from "./recent.ts";
import { clampText, decodeEntities, joinTitleAndBody } from "./text.ts";
import { ConnectorError, resolveContext, type Connector, type ConnectorContext, type NormalizedMention } from "./types.ts";

export const youtubeConfigSchema = z
  .object({
    query: z.string().trim().max(200).optional(),
    channelId: z
      .string()
      .trim()
      .regex(/^UC[\w-]{22}$/, "El ID de canal empieza con UC y tiene 24 caracteres.")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    includeComments: z.boolean().default(true),
    requireMatch: z.boolean().optional(),
  })
  .refine((c) => Boolean(c.query) || Boolean(c.channelId), { message: "Escribe una búsqueda o un ID de canal." });
export type YoutubeConfig = z.infer<typeof youtubeConfigSchema>;

const API = "https://www.googleapis.com/youtube/v3";
const MAX_COMMENT_PAGES = 2;

type ApiError = { error?: { code?: number; message?: string; errors?: { reason?: string }[] } };
type SearchResponse = ApiError & {
  items?: { id?: { videoId?: string }; snippet?: { title?: string; description?: string; publishedAt?: string; channelId?: string; channelTitle?: string } }[];
};
type VideosResponse = ApiError & {
  items?: { id: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }[];
};
type CommentsResponse = ApiError & {
  nextPageToken?: string;
  items?: {
    id: string;
    snippet?: { topLevelComment?: { id: string; snippet?: { textOriginal?: string; textDisplay?: string; publishedAt?: string; likeCount?: number } } };
  }[];
};

function apiUrl(ctx: ConnectorContext, path: string, params: Record<string, string | undefined>): string {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  url.searchParams.set("key", ctx.env.youtubeApiKey!);
  return url.toString();
}

async function getApi<T extends ApiError>(ctx: ConnectorContext, url: string): Promise<T> {
  const { status, body } = await fetchJson<T>(ctx.fetch, url);
  if (body.error || status >= 400) {
    const reason = body.error?.errors?.[0]?.reason;
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
      throw new ConnectorError("Se agotó la cuota diaria de la API de YouTube; se reintentará mañana.");
    }
    if (reason === "keyInvalid") throw new ConnectorError("YOUTUBE_API_KEY no es válida.");
    if (process.env.NODE_ENV !== "test") console.warn("[youtube]", status, redactUrl(url));
    const error = new ConnectorError(`YouTube respondió: ${body.error?.message ?? `HTTP ${status}`}`);
    (error as ConnectorError & { reason?: string }).reason = reason;
    throw error;
  }
  return body;
}

const toInt = (v: string | undefined) => (v ? Number.parseInt(v, 10) || 0 : 0);

export const youtubeConnector: Connector<YoutubeConfig> = {
  type: "youtube",
  label: "YouTube",
  enabled: true,
  requiresSecret: false,
  configSchema: youtubeConfigSchema,
  defaultRequireMatch: true,

  async fetchSince(source, since, ctxInput) {
    const ctx = resolveContext(ctxInput);
    if (!ctx.env.youtubeApiKey) throw new ConnectorError("Falta configurar YOUTUBE_API_KEY en el servidor.");
    const { query, channelId, includeComments } = source.config;

    // search.list costs 100 quota units: one call per run.
    const search = await getApi<SearchResponse>(
      ctx,
      apiUrl(ctx, "search", {
        part: "snippet",
        type: "video",
        order: "date",
        maxResults: "25",
        publishedAfter: since.toISOString(),
        q: query,
        channelId,
        regionCode: "MX",
        relevanceLanguage: "es",
      }),
    );

    const videos = (search.items ?? []).filter((item) => item.id?.videoId && item.snippet?.publishedAt);
    const stats = new Map<string, NonNullable<VideosResponse["items"]>[number]["statistics"]>();
    if (videos.length) {
      const res = await getApi<VideosResponse>(
        ctx,
        apiUrl(ctx, "videos", { part: "statistics", id: videos.map((v) => v.id!.videoId!).join(",") }),
      );
      for (const item of res.items ?? []) stats.set(item.id, item.statistics);
    }

    const mentions: NormalizedMention[] = [];
    const found: RecentItem[] = [];
    for (const video of videos) {
      const id = video.id!.videoId!;
      const snippet = video.snippet!;
      found.push({ id, publishedAt: snippet.publishedAt! });
      const s = stats.get(id);
      mentions.push({
        externalId: `video:${id}`,
        url: `https://www.youtube.com/watch?v=${id}`,
        text: clampText(joinTitleAndBody(decodeEntities(snippet.title ?? ""), decodeEntities(snippet.description ?? ""))),
        publishedAt: new Date(snippet.publishedAt!).toISOString(),
        kind: "video",
        author: snippet.channelId
          ? { platform: "youtube", handle: snippet.channelId, displayName: snippet.channelTitle ?? null, followers: null, kind: "media" }
          : null,
        metrics: { views: toInt(s?.viewCount), likes: toInt(s?.likeCount), comments: toInt(s?.commentCount) },
      });
    }

    const recent = mergeRecent(readRecent(source.cursor, "recentVideos"), found, ctx.now());
    if (includeComments) {
      for (const video of recent) {
        let pageToken: string | undefined;
        for (let pageNo = 0; pageNo < MAX_COMMENT_PAGES; pageNo++) {
          let res: CommentsResponse;
          try {
            res = await getApi<CommentsResponse>(
              ctx,
              apiUrl(ctx, "commentThreads", {
                part: "snippet",
                videoId: video.id,
                order: "time",
                maxResults: "50",
                textFormat: "plainText",
                pageToken,
              }),
            );
          } catch (error) {
            // Comments disabled or video gone: skip that video, keep the run.
            const reason = (error as { reason?: string }).reason;
            if (reason === "commentsDisabled" || reason === "videoNotFound") break;
            throw error;
          }
          let reachedOld = false;
          for (const thread of res.items ?? []) {
            const top = thread.snippet?.topLevelComment;
            const publishedAt = top?.snippet?.publishedAt;
            if (!top || !publishedAt) continue;
            if (new Date(publishedAt) <= since) {
              reachedOld = true;
              break;
            }
            const text = (top.snippet?.textOriginal ?? top.snippet?.textDisplay ?? "").trim();
            if (!text) continue;
            mentions.push({
              externalId: `comment:${top.id}`,
              url: `https://www.youtube.com/watch?v=${video.id}&lc=${top.id}`,
              text: clampText(text),
              publishedAt: new Date(publishedAt).toISOString(),
              kind: "comment",
              author: null, // commenters are citizens: not stored
              metrics: { likes: top.snippet?.likeCount ?? 0 },
            });
          }
          pageToken = reachedOld ? undefined : res.nextPageToken;
          if (!pageToken) break;
        }
        if (mentions.length >= ctx.limit) break;
      }
    }

    return { mentions: mentions.slice(0, ctx.limit), cursor: { recentVideos: recent } };
  },
};
