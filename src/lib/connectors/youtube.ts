// YouTube Data API v3 connector: videos found by a search and/or a channel,
// plus comments on recent ones. Uses the server-wide YOUTUBE_API_KEY.
import { z } from "zod";
import { fetchJson, redactUrl } from "./http.ts";
import { MAX_RECENT, mergeRecent, readRecent, type RecentItem } from "./recent.ts";
import { clampText, decodeEntities, joinTitleAndBody } from "./text.ts";
import {
  ConnectorError,
  resolveContext,
  timeUp,
  type Connector,
  type ConnectorContext,
  type CoverageLimit,
  type NormalizedMention,
} from "./types.ts";
import { exclusiveEnd, readNewestFirst } from "./window.ts";

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
const MAX_SEARCH_PAGES = 2;
const MAX_COMMENT_PAGES = 5;

type ApiError = { error?: { code?: number; message?: string; errors?: { reason?: string }[] } };
type SearchResponse = ApiError & {
  nextPageToken?: string;
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
  const { status, body } = await fetchJson<T>(ctx.fetch, url, { signal: ctx.signal });
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
    const until = ctx.until ?? ctx.now();
    const runAt = ctx.now().toISOString();

    // search.list costs 100 quota units per page: at most MAX_SEARCH_PAGES per
    // run; what is left is read next run (publishedBefore = where it stopped).
    type Video = NonNullable<SearchResponse["items"]>[number];
    const search = await readNewestFirst<Video>({
      ctx,
      since,
      maxPages: MAX_SEARCH_PAGES,
      label: "Videos",
      timeOf: (item) => new Date(item.snippet?.publishedAt ?? 0),
      fetchPage: async (pageToken) => {
        const res = await getApi<SearchResponse>(
          ctx,
          apiUrl(ctx, "search", {
            part: "snippet",
            type: "video",
            order: "date",
            maxResults: "50",
            publishedAfter: since.toISOString(),
            publishedBefore: exclusiveEnd(until).toISOString(),
            q: query,
            channelId,
            regionCode: "MX",
            relevanceLanguage: "es",
            pageToken,
          }),
        );
        return { items: (res.items ?? []).filter((item) => item.id?.videoId && item.snippet?.publishedAt), next: res.nextPageToken };
      },
    });
    const videos = search.items;
    const limits: CoverageLimit[] = [...search.limits];
    let interruptedBy = search.interruptedBy;

    const stats = new Map<string, NonNullable<VideosResponse["items"]>[number]["statistics"]>();
    for (let i = 0; i < videos.length && !interruptedBy; i += 50) {
      try {
        const res = await getApi<VideosResponse>(
          ctx,
          apiUrl(ctx, "videos", { part: "statistics", id: videos.slice(i, i + 50).map((v) => v.id!.videoId!).join(",") }),
        );
        for (const item of res.items ?? []) stats.set(item.id, item.statistics);
      } catch (error) {
        // Videos are kept without metrics; they are refreshed when seen again.
        limits.push({ kind: "error", detail: `Métricas de videos: ${error instanceof ConnectorError ? error.message : "falló la consulta"}.` });
      }
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
        // Only the configured channel is vouched; channels found by an open search are not media by default.
        author: snippet.channelId
          ? snippet.channelId === source.config.channelId
            ? { platform: "youtube", handle: snippet.channelId, displayName: snippet.channelTitle ?? null, followers: null, kind: "media", vouched: true }
            : { platform: "youtube", handle: snippet.channelId, displayName: null, followers: null, kind: null, vouched: false }
          : null,
        metrics: s ? { views: toInt(s.viewCount), likes: toInt(s.likeCount), comments: toInt(s.commentCount) } : {},
      });
    }

    const previous = readRecent(source.cursor, "recentVideos");
    // Videos tracked before per-video watermarks existed were polled from `since`.
    const legacy = new Set(previous.filter((v) => !v.commentsUntil).map((v) => v.id));
    const { items: recent, dropped } = mergeRecent(previous, found, ctx.now());
    if (dropped) {
      limits.push({ kind: "recent", detail: `Comentarios: sólo se siguen los ${MAX_RECENT} videos más recientes; ${dropped} dejaron de seguirse.` });
    }

    if (includeComments && !interruptedBy) {
      // Comment threads only come newest first and their page tokens expire:
      // each video keeps a watermark; a video with more new comments than the
      // page cap gets the rest reported as a gap (YouTube cannot resume there).
      videos: for (const video of recent) {
        const watermark = video.commentsUntil ? new Date(video.commentsUntil) : legacy.has(video.id) ? since : null;
        let pageToken: string | undefined;
        let oldest: string | null = null;
        for (let pageNo = 0; ; pageNo++) {
          if (timeUp(ctx)) {
            limits.push({ kind: "time", detail: "Comentarios: se acabó el tiempo; continúan en la siguiente corrida." });
            break videos; // this video's watermark stays: the next run reads it again
          }
          if (pageNo >= MAX_COMMENT_PAGES) {
            limits.push({
              kind: "comments",
              detail: `Comentarios del video ${video.id}: más de ${MAX_COMMENT_PAGES * 100} nuevos; sin leer entre ${video.commentsUntil ?? video.publishedAt} y ${oldest}.`,
            });
            video.commentsUntil = runAt;
            break;
          }
          let res: CommentsResponse;
          try {
            res = await getApi<CommentsResponse>(
              ctx,
              apiUrl(ctx, "commentThreads", {
                part: "snippet",
                videoId: video.id,
                order: "time",
                maxResults: "100",
                textFormat: "plainText",
                pageToken,
              }),
            );
          } catch (error) {
            // Comments disabled or video gone: stop following that video, keep the run.
            const reason = (error as { reason?: string }).reason;
            if (reason === "commentsDisabled" || reason === "videoNotFound") {
              video.commentsUntil = runAt;
              break;
            }
            interruptedBy = error instanceof ConnectorError ? error.message : "Error inesperado del proveedor.";
            limits.push({ kind: "error", detail: `Comentarios del video ${video.id}: falló la lectura.` });
            break videos;
          }
          let reachedOld = false;
          for (const thread of res.items ?? []) {
            const top = thread.snippet?.topLevelComment;
            const publishedAt = top?.snippet?.publishedAt;
            if (!top || !publishedAt) continue;
            if (watermark && new Date(publishedAt) <= watermark) {
              reachedOld = true;
              continue;
            }
            oldest = publishedAt;
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
          if (!pageToken) {
            video.commentsUntil = runAt;
            break;
          }
        }
        if (mentions.length >= ctx.limit) break;
      }
    }

    return {
      mentions: mentions.slice(0, ctx.limit),
      cursor: { recentVideos: recent },
      complete: search.complete,
      resumeUntil: search.resumeUntil,
      limits,
      interruptedBy,
    };
  },
};
