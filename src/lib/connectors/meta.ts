// Facebook Pages connector (Graph API): posts of an official page and the
// comments on them, read with that page's access token (stored in Vault).
import { createHmac } from "node:crypto";
import { z } from "zod";
import { fetchJson, redactUrl } from "./http.ts";
import { mergeRecent, readRecent, type RecentItem } from "./recent.ts";
import { clampText } from "./text.ts";
import { ConnectorError, resolveContext, type AuthorRef, type Connector, type ConnectorContext, type NormalizedMention } from "./types.ts";

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
const MAX_POST_PAGES = 4;
const MAX_COMMENT_PAGES = 3;

type GraphError = { error?: { message?: string; code?: number; type?: string } };
type Paged<T> = GraphError & { data?: T[]; paging?: { next?: string } };
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
  const { status, body } = await fetchJson<T>(ctx.fetch, url);
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
    const sinceUnix = String(Math.floor(since.getTime() / 1000));

    const page = await getGraph<GraphPage>(ctx, graphUrl(ctx, pageId, { fields: "id,name,username,followers_count" }));
    const author: AuthorRef = {
      platform: "meta",
      handle: page.username ?? page.id,
      displayName: page.name ?? null,
      followers: page.followers_count ?? null,
      kind: "public_figure",
    };

    const mentions: NormalizedMention[] = [];
    const newPosts: RecentItem[] = [];
    let url: string | undefined = graphUrl(ctx, `${page.id}/posts`, {
      fields:
        "id,message,created_time,permalink_url,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)",
      since: sinceUnix,
      limit: "25",
    });
    for (let pageNo = 0; url && pageNo < MAX_POST_PAGES && mentions.length < ctx.limit; pageNo++) {
      const body: Paged<GraphPost> = await getGraph<Paged<GraphPost>>(ctx, url);
      for (const post of body.data ?? []) {
        newPosts.push({ id: post.id, publishedAt: post.created_time });
        if (!post.message?.trim() || new Date(post.created_time) <= since) continue;
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
      url = body.paging?.next;
    }

    const recent = mergeRecent(readRecent(source.cursor, "recentPosts"), newPosts, ctx.now());
    if (includeComments) {
      for (const post of recent) {
        let next: string | undefined = graphUrl(ctx, `${post.id}/comments`, {
          fields: "id,message,created_time,permalink_url,like_count",
          filter: "stream",
          order: "reverse_chronological",
          limit: "100",
        });
        for (let pageNo = 0; next && pageNo < MAX_COMMENT_PAGES; pageNo++) {
          const body: Paged<GraphComment> = await getGraph<Paged<GraphComment>>(ctx, next);
          let reachedOld = false;
          for (const comment of body.data ?? []) {
            if (new Date(comment.created_time) <= since) {
              reachedOld = true;
              break;
            }
            if (!comment.message?.trim()) continue;
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
          next = reachedOld ? undefined : body.paging?.next;
        }
        if (mentions.length >= ctx.limit) break;
      }
    }

    return { mentions: mentions.slice(0, ctx.limit), cursor: { recentPosts: recent } };
  },
};
