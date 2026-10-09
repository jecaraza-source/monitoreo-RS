// Common contract for every ingestion connector.
//
// fetchSince(source, since) returns the public items published after `since`,
// already normalized. Connectors never touch the database: the ingest worker
// dedupes, assigns queries and stores what they return.

import type { z } from "zod";

export type SourceType = "meta" | "rss" | "youtube" | "x";

/** Media outlets and public figures only: citizens are never stored as authors (CLAUDE.md). */
export type AuthorRef = {
  platform: SourceType;
  handle: string;
  displayName: string | null;
  followers: number | null;
  kind: "media" | "public_figure";
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

export type FetchResult = {
  mentions: NormalizedMention[];
  /** Connector progress to persist for the next run (e.g. recent posts to poll for comments). */
  cursor?: Record<string, unknown>;
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
    metaAppSecret?: string;
    metaGraphVersion?: string;
  };
  /** Upper bound of items to return in one run. */
  limit: number;
};

export type Connector<C = unknown> = {
  type: SourceType;
  label: string;
  enabled: boolean;
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
      metaAppSecret: process.env.META_APP_SECRET,
      metaGraphVersion: process.env.META_GRAPH_VERSION,
    },
    limit: ctx.limit ?? 200,
  };
}
