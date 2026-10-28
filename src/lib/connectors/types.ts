// Common contract for every ingestion connector.
//
// fetchSince(source, since, { until }) returns the public items published in
// the window (since, until], already normalized, and says how much of the
// window it really covered. Connectors never touch the database: the ingest
// worker dedupes, assigns queries, stores what they return and moves the
// source's coverage watermark only over what was read (src/lib/ingest/coverage.ts).

import type { z } from "zod";

export type SourceType = "meta" | "rss" | "youtube" | "x" | "bluesky" | "reddit" | "rss_bridge" | "apify";

/**
 * The account that published an item. Connectors only claim what the source
 * configuration proves: `vouched` is true for the outlet, page or channel the
 * source is configured to read (RSS host, Meta page, YouTube channel id). Any
 * other account (e.g. a channel found by an open YouTube search) is not
 * verified: ingestion stores it as a pseudonym, without name or followers,
 * unless the org's catalog of verified authors lists it (upsert_authors).
 */
export type AuthorRef = {
  platform: SourceType;
  handle: string;
  displayName: string | null;
  followers: number | null;
  /** What the account would be if vouched; null when the connector cannot tell. */
  kind: "media" | "public_figure" | null;
  vouched: boolean;
};

export type NormalizedMention = {
  /** Stable id within the source; (source_id, external_id) is the dedupe key. */
  externalId: string;
  url: string | null;
  text: string;
  /** ISO 8601. */
  publishedAt: string;
  kind: "article" | "post" | "comment" | "video";
  author: AuthorRef | null;
  metrics: Partial<Record<"likes" | "shares" | "comments" | "views", number>>;
};

/** A cap the run reached. Reported in ingest_runs.limits; what it left behind is read next run or reported as a gap. */
export type CoverageLimit = {
  kind: "pages" | "items" | "time" | "tie" | "comments" | "recent" | "feed_window" | "error";
  detail: string;
};

export type FetchResult = {
  mentions: NormalizedMention[];
  /** Connector progress to persist for the next run (e.g. recent posts to poll for comments). */
  cursor?: Record<string, unknown>;
  /** Every item of the window was returned (or deliberately filtered). */
  complete: boolean;
  /**
   * When incomplete: the provider lists newest first and the read stopped at
   * this publication time; items published up to it (inclusive) are still
   * unread. The next run reads (since, resumeUntil].
   */
  resumeUntil?: string;
  /** Items the provider can no longer return (e.g. a feed that rolled past them): reported, not retried. */
  gap?: { from: string; to: string };
  limits: CoverageLimit[];
  /** A request failed after some pages were read: what was read is kept and the rest is resumed. */
  interruptedBy?: string;
};

export type ConnectorSource<C> = {
  id: string;
  config: C;
  cursor: Record<string, unknown>;
};

export type ConnectorContext = {
  fetch: typeof fetch;
  now: () => Date;
  /** Decrypted per-source credential (e.g. Meta page token), when the connector needs one. */
  secret: string | null;
  env: {
    youtubeApiKey?: string;
    blueskyIdentifier?: string;
    blueskyAppPassword?: string;
    blueskyService?: string;
    redditClientId?: string;
    redditClientSecret?: string;
    redditUserAgent?: string;
    /** Test/staging overrides of the provider hosts (the real ones by default). */
    redditAuthUrl?: string;
    redditApiUrl?: string;
    metaAppSecret?: string;
    metaGraphVersion?: string;
    apifyToken?: string;
    /** Test/staging override of the Apify API host. */
    apifyApiUrl?: string;
  };
  /** Upper bound of items to return (previews); a run is bounded by pages and time instead. */
  limit: number;
  /** End of the window (inclusive). Defaults to now. */
  until?: Date;
  /** Soft deadline (epoch ms): no new request starts after it; the connector returns what it has. */
  deadline?: number;
  /** Cancels the run (source timeout, caller gone): in-flight requests and body reads stop. */
  signal?: AbortSignal;
};

/** Time left before the soft deadline is over: stop starting requests. */
export function timeUp(ctx: Pick<ConnectorContext, "deadline">): boolean {
  return ctx.deadline !== undefined && Date.now() >= ctx.deadline;
}

export type Connector<C = unknown> = {
  type: SourceType;
  label: string;
  enabled: boolean;
  /**
   * Reads through an official API or the publisher's own feed. Unofficial
   * connectors (third-party scrapers and feed bridges) are marked as such
   * wherever their content shows, and only an admin can connect them.
   */
  official: boolean;
  /** A per-source credential must be stored (Vault) before the source can run. */
  requiresSecret: boolean;
  configSchema: z.ZodType<C>;
  /** Keep only items that match an active query (the default for broad sources like RSS). */
  defaultRequireMatch: boolean;
  fetchSince(source: ConnectorSource<C>, since: Date, ctx?: Partial<ConnectorContext>): Promise<FetchResult>;
};

/** Expected, user-actionable failure (bad token, feed not found…). Message is shown in the UI. */
export class ConnectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorError";
  }
}

export function resolveContext(ctx: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    fetch: ctx.fetch ?? fetch,
    now: ctx.now ?? (() => new Date()),
    secret: ctx.secret ?? null,
    env: ctx.env ?? {
      youtubeApiKey: process.env.YOUTUBE_API_KEY,
      blueskyIdentifier: process.env.BLUESKY_IDENTIFIER,
      blueskyAppPassword: process.env.BLUESKY_APP_PASSWORD,
      blueskyService: process.env.BLUESKY_SERVICE,
      redditClientId: process.env.REDDIT_CLIENT_ID,
      redditClientSecret: process.env.REDDIT_CLIENT_SECRET,
      redditUserAgent: process.env.REDDIT_USER_AGENT,
      redditAuthUrl: process.env.REDDIT_AUTH_URL,
      redditApiUrl: process.env.REDDIT_API_URL,
      metaAppSecret: process.env.META_APP_SECRET,
      metaGraphVersion: process.env.META_GRAPH_VERSION,
      apifyToken: process.env.APIFY_TOKEN,
      apifyApiUrl: process.env.APIFY_API_URL,
    },
    limit: ctx.limit ?? Number.POSITIVE_INFINITY,
    until: ctx.until,
    deadline: ctx.deadline,
    signal: ctx.signal,
  };
}
