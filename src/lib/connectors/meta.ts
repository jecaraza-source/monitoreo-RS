// Facebook Pages connector (Graph API): posts of an official page and the
// comments on them, read with that page's access token (stored in Vault).
import { createHmac } from "node:crypto";
import { z } from "zod";
import { fetchJson, redactUrl } from "./http.ts";
import { MAX_RECENT, mergeRecent, readRecent, type RecentItem } from "./recent.ts";
import { clampText } from "./text.ts";
import {
  ConnectorError,
  resolveContext,
  timeUp,
  type AuthorRef,
  type Connector,
  type ConnectorContext,
  type CoverageLimit,
  type NormalizedMention,
} from "./types.ts";
import { exclusiveEnd, readNewestFirst } from "./window.ts";

export const metaConfigSchema = z.object({
  pageId: z
    .string()
    .trim()
    .regex(/^[\w.]{2,100}$/, "Escribe el ID numérico o el nombre de usuario de la página."),
  includeComments: z.boolean().default(true),
  requireMatch: z.boolean().optional(),
});
export type MetaConfig = z.infer<typeof metaConfigSchema>;

const DEFAULT_GRAPH_VERSION = "v23.0";
const MAX_POST_PAGES = 10;
const POSTS_PER_PAGE = 100;
const MAX_COMMENT_PAGES = 5;
const COMMENTS_PER_PAGE = 100;

type GraphError = { error?: { message?: string; code?: number; type?: string } };
type Paged<T> = GraphError & { data?: T[]; paging?: { next?: string; cursors?: { before?: string; after?: string } } };
type GraphPost = {
  id: string;
  message?: string;
  created_time: string;
  permalink_url?: string;
  shares?: { count?: number };
  reactions?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
};
type GraphComment = { id: string; message?: string; created_time: string; permalink_url?: string; like_count?: number };
type GraphPage = GraphError & { id: string; name?: string; username?: string; followers_count?: number };

function graphError(body: GraphError, status: number): ConnectorError {
  const code = body.error?.code;
  if (code === 190) return new ConnectorError("El token de la página expiró o no es válido (Meta 190). Vuelve a conectarla.");
  if (code === 10 || code === 200) {
    return new ConnectorError("El token no tiene permiso para leer esta página (Meta " + code + "). Usa un token de página.");
  }
  if (code === 4 || code === 17 || code === 32) return new ConnectorError("Meta limitó las consultas por ahora; se reintentará.");
  return new ConnectorError(`Meta respondió: ${body.error?.message ?? `HTTP ${status}`}`);
}

function graphUrl(ctx: ConnectorContext, path: string, params: Record<string, string>): string {
  const version = ctx.env.metaGraphVersion || DEFAULT_GRAPH_VERSION;
  const url = new URL(`https://graph.facebook.com/${version}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", ctx.secret!);
  // appsecret_proof proves the call comes from our server (recommended by Meta).
  if (ctx.env.metaAppSecret) {
    url.searchParams.set("appsecret_proof", createHmac("sha256", ctx.env.metaAppSecret).update(ctx.secret!).digest("hex"));
  }
  return url.toString();
}

async function getGraph<T extends GraphError>(ctx: ConnectorContext, url: string): Promise<T> {
  const { status, body } = await fetchJson<T>(ctx.fetch, url, { signal: ctx.signal });
  if (body.error || status >= 400) {
    if (process.env.NODE_ENV !== "test") console.warn("[meta]", status, redactUrl(url));
    throw graphError(body, status);
  }
  return body;
}

export const metaConnector: Connector<MetaConfig> = {
  type: "meta",
  label: "Facebook (página oficial)",
  enabled: true,
  requiresSecret: true,
  configSchema: metaConfigSchema,
  // Comments on the municipality's own page are relevant even without keywords.
  defaultRequireMatch: false,

  async fetchSince(source, since, ctxInput) {
    const ctx = resolveContext(ctxInput);
    if (!ctx.secret) throw new ConnectorError("Falta el token de la página.");
    const { pageId, includeComments } = source.config;
    const until = ctx.until ?? ctx.now();

    const page = await getGraph<GraphPage>(ctx, graphUrl(ctx, pageId, { fields: "id,name,username,followers_count" }));
    const author: AuthorRef = {
      platform: "meta",
      handle: page.username ?? page.id,
      displayName: page.name ?? null,
      followers: page.followers_count ?? null,
      kind: "public_figure",
    };

    // Posts come newest first; since/until bound the window and the read
    // resumes at the oldest post reached when a cap stops it.
    const posts = await readNewestFirst<GraphPost>({
      ctx,
      since,
      maxPages: MAX_POST_PAGES,
      label: "Publicaciones",
      timeOf: (post) => new Date(post.created_time),
      fetchPage: async (next) => {
        const url =
          next ??
          graphUrl(ctx, `${page.id}/posts`, {
            fields:
              "id,message,created_time,permalink_url,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)",
            since: String(Math.floor(since.getTime() / 1000)),
            until: String(Math.floor(exclusiveEnd(until).getTime() / 1000)),
            limit: String(POSTS_PER_PAGE),
          });
        const body = await getGraph<Paged<GraphPost>>(ctx, url);
        return { items: body.data ?? [], next: body.paging?.next };
      },
    });

    const mentions: NormalizedMention[] = [];
    const newPosts: RecentItem[] = [];
    for (const post of posts.items) {
      newPosts.push({ id: post.id, publishedAt: post.created_time });
      if (!post.message?.trim()) continue;
      mentions.push({
        externalId: post.id,
        url: post.permalink_url ?? null,
        text: clampText(post.message.trim()),
        publishedAt: new Date(post.created_time).toISOString(),
        kind: "post",
        author,
        metrics: {
          likes: post.reactions?.summary?.total_count ?? 0,
          shares: post.shares?.count ?? 0,
          comments: post.comments?.summary?.total_count ?? 0,
        },
      });
    }

    const limits: CoverageLimit[] = [...posts.limits];
    let interruptedBy = posts.interruptedBy;
    const previous = readRecent(source.cursor, "recentPosts");
    // Posts tracked before per-post cursors existed: their older comments were already read.
    const legacy = new Set(previous.filter((p) => !p.after).map((p) => p.id));
    const { items: recent, dropped } = mergeRecent(previous, newPosts, ctx.now());
    if (dropped) {
      limits.push({ kind: "recent", detail: `Comentarios: sólo se siguen las ${MAX_RECENT} publicaciones más recientes; ${dropped} dejaron de seguirse.` });
    }

    if (includeComments && !interruptedBy) {
      // Comments are read oldest first from each post's stored cursor, so a
      // run that stops early continues next time where it left off.
      posts: for (const post of recent) {
        for (let pageNo = 0; ; pageNo++) {
          if (timeUp(ctx)) {
            limits.push({ kind: "time", detail: "Comentarios: se acabó el tiempo; continúan en la siguiente corrida." });
            break posts;
          }
          if (pageNo >= MAX_COMMENT_PAGES) {
            limits.push({ kind: "comments", detail: `Comentarios de ${post.id}: ${MAX_COMMENT_PAGES} páginas leídas; continúan en la siguiente corrida.` });
            break;
          }
          let body: Paged<GraphComment>;
          try {
            body = await getGraph<Paged<GraphComment>>(
              ctx,
              graphUrl(ctx, `${post.id}/comments`, {
                fields: "id,message,created_time,permalink_url,like_count",
                filter: "stream",
                order: "chronological",
                limit: String(COMMENTS_PER_PAGE),
                ...(post.after ? { after: post.after } : {}),
              }),
            );
          } catch (error) {
            if (post.after) {
              // An expired cursor: read this post's comments from the start next run (dedupe absorbs repeats).
              delete post.after;
              limits.push({ kind: "error", detail: `Comentarios de ${post.id}: el cursor ya no es válido; se releerán.` });
              break;
            }
            interruptedBy = error instanceof ConnectorError ? error.message : "Error inesperado del proveedor.";
            limits.push({ kind: "error", detail: `Comentarios de ${post.id}: falló la lectura.` });
            break posts;
          }
          for (const comment of body.data ?? []) {
            if (!comment.message?.trim()) continue;
            if (legacy.has(post.id) && new Date(comment.created_time) <= since) continue;
            // Commenters are citizens: their identity is not stored.
            mentions.push({
              externalId: comment.id,
              url: comment.permalink_url ?? null,
              text: clampText(comment.message.trim()),
              publishedAt: new Date(comment.created_time).toISOString(),
              kind: "comment",
              author: null,
              metrics: { likes: comment.like_count ?? 0 },
            });
          }
          post.after = body.paging?.cursors?.after ?? post.after;
          if (!body.paging?.next || mentions.length >= ctx.limit) break;
        }
        if (mentions.length >= ctx.limit) break;
      }
    }

    return {
      mentions: mentions.slice(0, ctx.limit),
      cursor: { recentPosts: recent },
      complete: posts.complete,
      resumeUntil: posts.resumeUntil,
      limits,
      interruptedBy,
    };
  },
};
