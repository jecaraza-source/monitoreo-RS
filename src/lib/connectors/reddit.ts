// Reddit connector (official Data API, application-only OAuth): new posts of
// a search, optionally within one subreddit, or the newest posts of a
// subreddit. Uses the institutional app's REDDIT_CLIENT_ID and
// REDDIT_CLIENT_SECRET; Reddit asks for a descriptive User-Agent.
import { z } from "zod";
import { fetchJson } from "./http.ts";
import { clampText, joinTitleAndBody } from "./text.ts";
import { ConnectorError, resolveContext, type Connector, type ConnectorContext, type NormalizedMention } from "./types.ts";
import { readNewestFirst } from "./window.ts";

export const redditConfigSchema = z
  .object({
    query: z.string().trim().max(200).optional(),
    subreddit: z
      .string()
      .trim()
      .transform((v) => v.replace(/^\/?r\//i, ""))
      .refine((v) => v === "" || /^[A-Za-z0-9_]{2,21}$/.test(v), "Escribe el subreddit sin «r/», por ejemplo veracruz.")
      .transform((v) => v || undefined)
      .optional(),
    requireMatch: z.boolean().optional(),
  })
  .refine((c) => Boolean(c.query) || Boolean(c.subreddit), { message: "Escribe una búsqueda o un subreddit." });
export type RedditConfig = z.infer<typeof redditConfigSchema>;

const AUTH = "https://www.reddit.com/api/v1/access_token";
const API = "https://oauth.reddit.com";
const DEFAULT_UA = "web:sigma-pulso:1.0 (monitoreo municipal; contenido público)";
const MAX_PAGES = 3;

type Token = { access_token?: string; error?: string };
type Listing = {
  data?: {
    after?: string | null;
    children?: {
      kind?: string;
      data?: { id?: string; name?: string; title?: string; selftext?: string; created_utc?: number; permalink?: string; subreddit?: string; score?: number; num_comments?: number; over_18?: boolean };
    }[];
  };
  message?: string;
  error?: number;
};
type RedditPost = NonNullable<NonNullable<NonNullable<Listing["data"]>["children"]>[number]["data"]>;

const userAgent = (ctx: ConnectorContext) => ctx.env.redditUserAgent || DEFAULT_UA;

async function getToken(ctx: ConnectorContext): Promise<string> {
  const basic = Buffer.from(`${ctx.env.redditClientId}:${ctx.env.redditClientSecret}`).toString("base64");
  const { status, body } = await fetchJson<Token>(ctx.fetch, ctx.env.redditAuthUrl || AUTH, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", "user-agent": userAgent(ctx) },
    body: "grant_type=client_credentials",
    signal: ctx.signal,
  });
  if (status === 401 || body.error === "invalid_client") throw new ConnectorError("Reddit rechazó REDDIT_CLIENT_ID o REDDIT_CLIENT_SECRET.");
  if (status === 429) throw new ConnectorError("Reddit limitó las consultas; se reintentará más tarde.");
  if (status >= 400 || !body.access_token) throw new ConnectorError(`Reddit respondió: ${body.error ?? `HTTP ${status}`}`);
  return body.access_token;
}

export const redditConnector: Connector<RedditConfig> = {
  type: "reddit",
  label: "Reddit",
  enabled: true,
  official: true,
  requiresSecret: false,
  configSchema: redditConfigSchema,
  defaultRequireMatch: true,

  async fetchSince(source, since, ctxInput) {
    const ctx = resolveContext(ctxInput);
    if (!ctx.env.redditClientId || !ctx.env.redditClientSecret) {
      throw new ConnectorError("Falta configurar REDDIT_CLIENT_ID y REDDIT_CLIENT_SECRET en el servidor.");
    }
    const { query, subreddit } = source.config;
    const until = (ctx.until ?? ctx.now()).getTime();
    const token = await getToken(ctx);
    const api = (ctx.env.redditApiUrl || API).replace(/\/$/, "");

    const read = await readNewestFirst<RedditPost>({
      ctx,
      since,
      maxPages: MAX_PAGES,
      label: "Publicaciones",
      timeOf: (p) => new Date((p.created_utc ?? 0) * 1000),
      fetchPage: async (after) => {
        const path = query ? `${subreddit ? `/r/${subreddit}` : ""}/search` : `/r/${subreddit}/new`;
        const url = new URL(`${api}${path}`);
        if (query) {
          url.searchParams.set("q", query);
          url.searchParams.set("sort", "new");
          url.searchParams.set("type", "link");
          if (subreddit) url.searchParams.set("restrict_sr", "1");
        }
        url.searchParams.set("limit", "100");
        url.searchParams.set("raw_json", "1");
        if (after) url.searchParams.set("after", after);
        const { status, body } = await fetchJson<Listing>(ctx.fetch, url.toString(), {
          headers: { authorization: `Bearer ${token}`, "user-agent": userAgent(ctx) },
          signal: ctx.signal,
        });
        if (status === 429) throw new ConnectorError("Reddit limitó las consultas; se reintentará más tarde.");
        if (status === 403 || status === 404) throw new ConnectorError(`Reddit no permite leer ${subreddit ? `r/${subreddit}` : "la búsqueda"} (HTTP ${status}).`);
        if (status >= 400) throw new ConnectorError(`Reddit respondió: ${body.message ?? `HTTP ${status}`}`);
        const posts = (body.data?.children ?? [])
          .filter((c) => c.kind === "t3" && c.data?.id && c.data.created_utc)
          .map((c) => c.data!)
          // Newer than the window end: left for the run that covers it.
          .filter((p) => p.created_utc! * 1000 <= until);
        return { items: posts, next: body.data?.after ?? undefined };
      },
    });

    const mentions: NormalizedMention[] = read.items
      .filter((p) => !p.over_18)
      .map((p) => ({
        externalId: `t3_${p.id}`,
        url: p.permalink ? `https://www.reddit.com${p.permalink}` : null,
        text: clampText(joinTitleAndBody(p.title ?? "", p.selftext ?? "")),
        publishedAt: new Date(p.created_utc! * 1000).toISOString(),
        kind: "post" as const,
        // Redditors are anonymous by design and citizens here: never stored.
        author: null,
        metrics: { likes: Math.max(0, p.score ?? 0), comments: p.num_comments ?? 0 },
      }))
      .filter((m) => m.text);

    return {
      mentions: mentions.slice(0, ctx.limit),
      complete: read.complete,
      resumeUntil: read.resumeUntil,
      limits: read.limits,
      interruptedBy: read.interruptedBy,
    };
  },
};
