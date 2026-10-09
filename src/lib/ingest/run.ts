import "server-only";
import { getConnector, type SourceType } from "@/lib/connectors";
import { ConnectorError, type AuthorRef } from "@/lib/connectors/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { assignQueries, compileQueries, inBackoff, sinceFor, type Assigned, type CompiledQuery } from "./assign";

type Admin = ReturnType<typeof createAdminClient>;

export type SourceRunResult = {
  sourceId: string;
  name: string;
  status: "ok" | "error" | "skipped";
  fetched: number;
  inserted: number;
  duplicates: number;
  unmatched: number;
  error?: string;
};

export type IngestSummary = { startedAt: string; durationMs: number; sources: SourceRunResult[] };

type SourceRow = {
  id: string;
  org_id: string;
  name: string;
  type: SourceType;
  config: Json;
  cursor: Json;
  last_success_at: string | null;
  last_error_at: string | null;
  consecutive_failures: number;
};

const BATCH_SIZE = 12;
const CONCURRENCY = 3;
const SOURCE_TIMEOUT_MS = 25_000;
/** Stop starting new sources after this, to finish inside the function's maxDuration. */
const TIME_BUDGET_MS = 45_000;
const INSERT_CHUNK = 200;

/**
 * Runs due sources: fetch → assign queries (match.ts) → dedupe insert as
 * pending → record state and a run log. Uses the service role; callers must
 * authorize (CRON_SECRET or an editor's Server Action).
 */
export async function runIngest(options: {
  trigger: "cron" | "manual";
  /** Restrict to these sources (manual runs). Ignores backoff. */
  sourceIds?: string[];
  /** Restrict to one org (manual runs from the UI). */
  orgId?: string;
}): Promise<IngestSummary> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const admin = createAdminClient();

  let query = admin
    .from("sources")
    .select("id, org_id, name, type, config, cursor, last_success_at, last_error_at, consecutive_failures")
    .eq("is_active", true)
    .order("last_run_at", { ascending: true, nullsFirst: true })
    .limit(options.sourceIds ? options.sourceIds.length : BATCH_SIZE);
  if (options.sourceIds) query = query.in("id", options.sourceIds);
  if (options.orgId) query = query.eq("org_id", options.orgId);
  const { data: rows, error } = await query;
  if (error) throw new Error(`No se pudieron leer las fuentes: ${error.message}`);

  const now = new Date();
  const queue = (rows as SourceRow[]).filter((row) => {
    if (!getConnector(row.type).enabled) return false;
    if (options.trigger === "cron" && inBackoff(row.consecutive_failures, row.last_error_at, now)) return false;
    return true;
  });

  const queryCache = new Map<string, Promise<CompiledQuery[]>>();
  const results: SourceRunResult[] = [];
  let next = 0;
  async function worker() {
    while (next < queue.length) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      const row = queue[next++];
      results.push(await runSource(admin, row, options.trigger, queryCache));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return { startedAt, durationMs: Date.now() - started, sources: results };
}

function orgQueries(admin: Admin, orgId: string, cache: Map<string, Promise<CompiledQuery[]>>) {
  let entry = cache.get(orgId);
  if (!entry) {
    entry = (async () => {
      const { data } = await admin
        .from("queries")
        .select("id, expression")
        .eq("org_id", orgId)
        .eq("is_active", true)
        .order("created_at");
      const { compiled, invalid } = compileQueries(data ?? []);
      if (invalid.length) console.warn("[ingest] invalid queries skipped:", invalid.join(", "));
      return compiled;
    })();
    cache.set(orgId, entry);
  }
  return entry;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new ConnectorError("La fuente tardó demasiado.")), ms)),
  ]);
}

async function runSource(
  admin: Admin,
  row: SourceRow,
  trigger: "cron" | "manual",
  cache: Map<string, Promise<CompiledQuery[]>>,
): Promise<SourceRunResult> {
  const startedAt = new Date();
  const connector = getConnector(row.type);
  const result: SourceRunResult = { sourceId: row.id, name: row.name, status: "ok", fetched: 0, inserted: 0, duplicates: 0, unmatched: 0 };
  let cursor: Record<string, unknown> | undefined;

  try {
    const parsed = connector.configSchema.safeParse(row.config);
    if (!parsed.success) throw new ConnectorError(`Configuración inválida: ${parsed.error.issues[0]?.message}`);
    const config = parsed.data as { requireMatch?: boolean };

    let secret: string | null = null;
    if (connector.requiresSecret) {
      const { data } = await admin.rpc("get_source_secret", { p_source_id: row.id });
      secret = data ?? null;
      if (!secret) throw new ConnectorError("Falta la credencial de esta fuente.");
    }

    const since = sinceFor(row.last_success_at, startedAt);
    const fetched = await withTimeout(
      connector.fetchSince(
        { id: row.id, config: parsed.data, cursor: (row.cursor as Record<string, unknown>) ?? {} },
        since,
        { secret },
      ),
      SOURCE_TIMEOUT_MS,
    );
    cursor = fetched.cursor;
    result.fetched = fetched.mentions.length;

    const queries = await orgQueries(admin, row.org_id, cache);
    const { kept, unmatched } = assignQueries(fetched.mentions, queries, config.requireMatch ?? connector.defaultRequireMatch);
    result.unmatched = unmatched;
    const inserted = await storeMentions(admin, row, kept);
    result.inserted = inserted;
    result.duplicates = kept.length - inserted;
  } catch (error) {
    result.status = "error";
    result.error = error instanceof ConnectorError ? error.message : "Error inesperado al procesar la fuente.";
    if (!(error instanceof ConnectorError)) console.error("[ingest]", row.id, error);
  }

  const finishedAt = new Date().toISOString();
  await admin
    .from("sources")
    .update(
      result.status === "ok"
        ? {
            last_run_at: startedAt.toISOString(),
            last_success_at: startedAt.toISOString(),
            last_error: null,
            consecutive_failures: 0,
            ...(cursor ? { cursor: cursor as NonNullable<Json> } : {}),
          }
        : {
            last_run_at: startedAt.toISOString(),
            last_error: result.error,
            last_error_at: finishedAt,
            consecutive_failures: row.consecutive_failures + 1,
          },
    )
    .eq("id", row.id);

  await admin.from("ingest_runs").insert({
    org_id: row.org_id,
    source_id: row.id,
    trigger,
    status: result.status === "ok" ? "ok" : "error",
    started_at: startedAt.toISOString(),
    finished_at: finishedAt,
    fetched: result.fetched,
    inserted: result.inserted,
    duplicates: result.duplicates,
    unmatched: result.unmatched,
    error: result.error ?? null,
  });

  return result;
}

/** Upserts authors (media/public figures only) and inserts new mentions; returns how many were new. */
async function storeMentions(admin: Admin, row: SourceRow, mentions: Assigned[]): Promise<number> {
  if (mentions.length === 0) return 0;

  const authors = new Map<string, AuthorRef>();
  for (const m of mentions) if (m.author) authors.set(`${m.author.platform}:${m.author.handle}`, m.author);
  const authorIds = new Map<string, string>();
  if (authors.size) {
    const { data, error } = await admin
      .from("authors")
      .upsert(
        [...authors.values()].map((a) => ({
          org_id: row.org_id,
          platform: a.platform,
          handle: a.handle.slice(0, 200),
          display_name: a.displayName?.slice(0, 200) ?? null,
          followers: a.followers,
          kind: a.kind,
        })),
        { onConflict: "org_id,platform,handle" },
      )
      .select("id, platform, handle");
    if (error) throw new Error(`authors: ${error.message}`);
    for (const a of data ?? []) authorIds.set(`${a.platform}:${a.handle}`, a.id);
  }

  let inserted = 0;
  for (let i = 0; i < mentions.length; i += INSERT_CHUNK) {
    const chunk = mentions.slice(i, i + INSERT_CHUNK).map((m) => ({
      org_id: row.org_id,
      source_id: row.id,
      external_id: m.externalId,
      url: m.url,
      text: m.text,
      published_at: m.publishedAt,
      author_id: m.author ? (authorIds.get(`${m.author.platform}:${m.author.handle.slice(0, 200)}`) ?? null) : null,
      metrics: m.metrics,
      query_id: m.queryId,
      status: "pending" as const,
    }));
    // ON CONFLICT (source_id, external_id) DO NOTHING: only new rows come back.
    const { data, error } = await admin
      .from("mentions")
      .upsert(chunk, { onConflict: "source_id,external_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`mentions: ${error.message}`);
    inserted += data?.length ?? 0;
  }
  return inserted;
}
