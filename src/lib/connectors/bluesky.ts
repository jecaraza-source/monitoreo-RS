// Bluesky connector (AT Protocol, official API): public posts found by a
// search and/or posted by one account. Signs in with the institutional
// account's app password (BLUESKY_IDENTIFIER, BLUESKY_APP_PASSWORD); the app
// password can be revoked from Bluesky without touching the account.
import { z } from "zod";
import { fetchJson } from "./http.ts";
import { clampText } from "./text.ts";
import { ConnectorError, resolveContext, type Connector, type ConnectorContext, type NormalizedMention } from "./types.ts";
import { exclusiveEnd, readNewestFirst } from "./window.ts";

const HANDLE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const blueskyConfigSchema = z
  .object({
    query: z.string().trim().max(200).optional(),
    // An account the source reads (e.g. the municipality's own or a media outlet's): its posts are vouched.
    account: z
      .string()
      .trim()
      .toLowerCase()
      .transform((v) => v.replace(/^@/, ""))
      .refine((v) => v === "" || HANDLE.test(v), "Escribe la cuenta como dominio, por ejemplo medio.bsky.social.")
      .transform((v) => v || undefined)
      .optional(),
    requireMatch: z.boolean().optional(),
  })
  .refine((c) => Boolean(c.query) || Boolean(c.account), { message: "Escribe una búsqueda o una cuenta." });
export type BlueskyConfig = z.infer<typeof blueskyConfigSchema>;

const DEFAULT_SERVICE = "https://bsky.social";
const MAX_PAGES = 4;

type Session = { accessJwt?: string; error?: string; message?: string };
type Post = {
  uri?: string;
  author?: { did?: string; handle?: string; displayName?: string };
  record?: { text?: string; createdAt?: string };
  indexedAt?: string;
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  quoteCount?: number;
};
type SearchResponse = { posts?: Post[]; cursor?: string; error?: string; message?: string };
type FeedResponse = { feed?: { post?: Post; reason?: unknown }[]; cursor?: string; error?: string; message?: string };

const service = (ctx: ConnectorContext) => (ctx.env.blueskyService || DEFAULT_SERVICE).replace(/\/$/, "");

async function signIn(ctx: ConnectorContext): Promise<string> {
  const { status, body } = await fetchJson<Session>(ctx.fetch, `${service(ctx)}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: ctx.env.blueskyIdentifier, password: ctx.env.blueskyAppPassword }),
    signal: ctx.signal,
  });
  if (status === 401 || body.error === "AuthenticationRequired") throw new ConnectorError("Bluesky rechazó la cuenta o la contraseña de aplicación.");
  if (status === 429) throw new ConnectorError("Bluesky limitó los inicios de sesión; se reintentará más tarde.");
  if (status >= 400 || !body.accessJwt) throw new ConnectorError(`Bluesky respondió: ${body.message ?? `HTTP ${status}`}`);
  return body.accessJwt;
}

/** https://bsky.app link of a post; by DID so a later change of handle keeps it working. */
export function postUrl(uri: string, did: string): string | null {
  const rkey = /^at:\/\/[^/]+\/app\.bsky\.feed\.post\/([^/]+)$/.exec(uri)?.[1];
  return rkey ? `https://bsky.app/profile/${did}/post/${rkey}` : null;
}

export const blueskyConnector: Connector<BlueskyConfig> = {
  type: "bluesky",
  label: "Bluesky",
  enabled: true,
  requiresSecret: false,
  configSchema: blueskyConfigSchema,
  defaultRequireMatch: true,

  async fetchSince(source, since, ctxInput) {
    const ctx = resolveContext(ctxInput);
    if (!ctx.env.blueskyIdentifier || !ctx.env.blueskyAppPassword) {
      throw new ConnectorError("Falta configurar BLUESKY_IDENTIFIER y BLUESKY_APP_PASSWORD en el servidor.");
    }
    const { query, account } = source.config;
    const until = ctx.until ?? ctx.now();
    const token = await signIn(ctx);

    const read = await readNewestFirst<Post>({
      ctx,
      since,
      maxPages: MAX_PAGES,
      label: "Publicaciones",
      timeOf: (p) => new Date(p.record?.createdAt ?? p.indexedAt ?? 0),
      fetchPage: async (cursor) => {
        // A search (optionally limited to the account), or the account's own feed when there is no search.
        const url = new URL(`${service(ctx)}/xrpc/${query ? "app.bsky.feed.searchPosts" : "app.bsky.feed.getAuthorFeed"}`);
        if (query) {
          url.searchParams.set("q", query);
          url.searchParams.set("sort", "latest");
          url.searchParams.set("since", since.toISOString());
          url.searchParams.set("until", exclusiveEnd(until).toISOString());
          if (account) url.searchParams.set("author", account);
        } else {
          url.searchParams.set("actor", account!);
          url.searchParams.set("filter", "posts_no_replies");
        }
        url.searchParams.set("limit", "100");
        if (cursor) url.searchParams.set("cursor", cursor);
        const { status, body } = await fetchJson<SearchResponse & FeedResponse>(ctx.fetch, url.toString(), {
          headers: { authorization: `Bearer ${token}` },
          signal: ctx.signal,
        });
        if (status === 429) throw new ConnectorError("Bluesky limitó las consultas; se reintentará más tarde.");
        if (status >= 400) throw new ConnectorError(`Bluesky respondió: ${body.message ?? `HTTP ${status}`}`);
        // Reposts in a feed belong to someone else: skipped.
        const posts = query ? (body.posts ?? []) : (body.feed ?? []).filter((f) => !f.reason).map((f) => f.post ?? {});
        // The feed is not bounded by until: newer items are left for the run that covers them.
        const inWindow = posts.filter((p) => new Date(p.record?.createdAt ?? p.indexedAt ?? 0) <= exclusiveEnd(until));
        return { items: inWindow.filter((p) => p.uri && p.author?.did && (p.record?.createdAt || p.indexedAt)), next: body.cursor };
      },
    });

    const mentions: NormalizedMention[] = read.items.map((p) => {
      const did = p.author!.did!;
      const handle = (p.author!.handle ?? "").toLowerCase();
      const own = Boolean(account) && (handle === account || did === account);
      return {
        externalId: p.uri!,
        url: postUrl(p.uri!, did),
        text: clampText((p.record?.text ?? "").trim()),
        publishedAt: new Date(p.record?.createdAt ?? p.indexedAt!).toISOString(),
        kind: "post",
        // Only the configured account is vouched; anyone else found by the search is stored as a pseudonym.
        author: own
          ? { platform: "bluesky", handle, displayName: p.author!.displayName ?? null, followers: null, kind: "media", vouched: true }
          : // By handle so the catalog of verified authors can list it; stored as a pseudonym otherwise.
            { platform: "bluesky", handle: handle || did, displayName: null, followers: null, kind: null, vouched: false },
        metrics: { likes: p.likeCount ?? 0, shares: (p.repostCount ?? 0) + (p.quoteCount ?? 0), comments: p.replyCount ?? 0 },
      };
    });

    return {
      mentions: mentions.filter((m) => m.text).slice(0, ctx.limit),
      complete: read.complete,
      resumeUntil: read.resumeUntil,
      limits: read.limits,
      interruptedBy: read.interruptedBy,
    };
  },
};
