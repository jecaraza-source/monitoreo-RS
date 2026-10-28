import "server-only";
import { randomUUID } from "node:crypto";
import { CONNECTORS, getConnector, type SourceType } from "@/lib/connectors";
import { withDeadline } from "@/lib/connectors/http";
import { ConnectorError, type AuthorRef, type CoverageLimit, type FetchResult } from "@/lib/connectors/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshMentionStats } from "@/lib/dashboard/refresh";
import type { Json } from "@/lib/supabase/database.types";
import { assignQueries, compileQueries, type Assigned, type CompiledQuery } from "./assign";

/** Source types every database has (initial schema); newer ones need their migration. */
const LEGACY_TYPES: readonly SourceType[] = ["meta", "rss", "youtube", "x"];
import { applyResult, planWindow, readBackfill, type CoverageState } from "./coverage";

type Admin = ReturnType<typeof createAdminClient>;

export type SourceRunResult = {
  sourceId: string;
  name: string;
  status: "ok" | "partial" | "error" | "skipped";
  fetched: number;
  inserted: number;
  /** Known items whose interaction metrics changed. */
  updated: number;
  duplicates: number;
  unmatched: number;
  complete?: boolean;
  coveredUntil?: string | null;
  limits?: CoverageLimit[];
  error?: string;
};

export type IngestSummary = { runId: string; startedAt: string; durationMs: number; sources: SourceRunResult[] };

type SourceRow = {
  id: string;
  org_id: string;
  name: string;
  type: SourceType;
  config: Json;
  cursor: Json;
  covered_until: string | null;
  consecutive_failures: number;
};

const BATCH_SIZE = 12;
const CONCURRENCY = 3;
/** Hard stop for one source (requests are aborted). */
const SOURCE_TIMEOUT_MS = 25_000;
/** Soft stop for one source: no new request starts; what was read is kept and resumed next run. */
const SOURCE_SOFT_MS = 18_000;
/** Stop starting new sources after this, to finish inside the function's maxDuration. */
const TIME_BUDGET_MS = 45_000;
/** Longer than any run can last (maxDuration 60 s): a crashed worker's sources free up after it. */
const LEASE_SECONDS = 120;
const INSERT_CHUNK = 200;

/**
 * Runs due sources: claim (lease) → fetch the coverage window → assign
 * queries → store (dedupe + metrics refresh) → record state and run log in
 * one transaction. Uses the service role; callers must authorize (CRON_SECRET
 * or an editor's Server Action).
 */
export async function runIngest(options: {
  trigger: "cron" | "manual";
  /** Restrict to these sources (manual runs). Ignores backoff. */
  sourceIds?: string[];
  /** Restrict to one org (manual runs from the UI). */
  orgId?: string;
  /** Manual runs: refuse a source read less than this many seconds ago. */
  minGapSeconds?: number;
}): Promise<IngestSummary> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const runId = randomUUID();
  const admin = createAdminClient();
  // Only scheduled runs count as the job's heartbeat (a manual run of one source says nothing about the cron).
  if (options.trigger === "cron") await heartbeat(admin, "start");

  const enabledTypes = Object.values(CONNECTORS).filter((c) => c.enabled).map((c) => c.type);
  const claim = (types: SourceType[]) =>
    admin.rpc("claim_sources", {
      p_lease_id: runId,
      p_limit: options.sourceIds ? options.sourceIds.length : BATCH_SIZE,
      p_lease_seconds: LEASE_SECONDS,
      p_types: types,
      p_source_ids: options.sourceIds,
      p_org_id: options.orgId,
      p_respect_backoff: options.trigger === "cron",
      p_min_gap_seconds: options.minGapSeconds ?? 0,
    });
  let { data: rows, error } = await claim(enabledTypes);
  // A database without a newer source type (its migration not applied yet) rejects the whole list:
  // keep reading the types it has instead of stopping every source.
  if (error?.code === "22P02") {
    console.warn("[ingest] la base no tiene algún tipo de fuente nuevo; se leen los anteriores:", error.message);
    ({ data: rows, error } = await claim(enabledTypes.filter((t) => LEGACY_TYPES.includes(t))));
  }
  if (error) {
    if (options.trigger === "cron") await heartbeat(admin, "finish", error.message);
    throw new Error(`No se pudieron reservar las fuentes: ${error.message}`);
  }
  const queue = (rows ?? []) as SourceRow[];

  const queryCache = new Map<string, Promise<CompiledQuery[]>>();
  const results: SourceRunResult[] = [];
  const orgOf = new Map<string, string>();
  let next = 0;
  async function worker() {
    while (next < queue.length) {
      const row = queue[next++];
      orgOf.set(row.id, row.org_id);
      if (Date.now() - started > TIME_BUDGET_MS) {
        // Not started: free it now instead of waiting for the lease to expire.
        await admin.from("sources").update({ run_lease_id: null, run_lease_until: null }).eq("id", row.id).eq("run_lease_id", runId);
        results.push({ sourceId: row.id, name: row.name, status: "skipped", fetched: 0, inserted: 0, updated: 0, duplicates: 0, unmatched: 0 });
        continue;
      }
      results.push(await runSource(admin, runId, row, options.trigger, queryCache));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (results.some((r) => r.inserted > 0 || r.updated > 0)) await refreshMentionStats(admin);
  await logWorkerRuns(admin, runId, options.trigger, startedAt, results, orgOf);
  if (options.trigger === "cron") await heartbeat(admin, "finish");

  return { runId, startedAt, durationMs: Date.now() - started, sources: results };
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

async function runSource(
  admin: Admin,
  runId: string,
  row: SourceRow,
  trigger: "cron" | "manual",
  cache: Map<string, Promise<CompiledQuery[]>>,
): Promise<SourceRunResult> {
  const startedAt = new Date();
  const connector = getConnector(row.type);
  const result: SourceRunResult = {
    sourceId: row.id, name: row.name, status: "ok", fetched: 0, inserted: 0, updated: 0, duplicates: 0, unmatched: 0,
  };
  const previousCursor = (row.cursor as Record<string, unknown>) ?? {};
  const state: CoverageState = { coveredUntil: row.covered_until, backfill: readBackfill(previousCursor) };
  const plan = planWindow(state, startedAt);
  let next: { coveredUntil: string | null; cursor: Record<string, unknown> } | null = null;
  let gap: { from: string; to: string } | null = null;
  const limits: CoverageLimit[] = [];

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

    const fetched: FetchResult = await withDeadline(
      (signal) =>
        connector.fetchSince({ id: row.id, config: parsed.data, cursor: previousCursor }, plan.since, {
          secret,
          signal,
          until: plan.until,
          deadline: Date.now() + SOURCE_SOFT_MS,
        }),
      SOURCE_TIMEOUT_MS,
    );
    result.fetched = fetched.mentions.length;

    const queries = await orgQueries(admin, row.org_id, cache);
    const { kept, unmatched } = assignQueries(fetched.mentions, queries, config.requireMatch ?? connector.defaultRequireMatch);
    result.unmatched = unmatched;
    // Stored before the watermark moves: if this throws, coverage stays where it was.
    const stored = await storeMentions(admin, row, kept);
    result.inserted = stored.inserted;
    result.updated = stored.updated;
    result.duplicates = stored.unchanged;

    const outcome = applyResult(state, plan, fetched);
    gap = outcome.gap;
    limits.push(...fetched.limits, ...outcome.limits);
    next = {
      coveredUntil: outcome.state.coveredUntil,
      cursor: { ...previousCursor, ...(fetched.cursor ?? {}), backfill: outcome.state.backfill },
    };
    result.complete = fetched.complete;
    result.coveredUntil = outcome.state.coveredUntil;
    if (fetched.interruptedBy) result.error = fetched.interruptedBy;
    if (fetched.interruptedBy || !fetched.complete || gap || limits.length) result.status = "partial";
  } catch (error) {
    result.status = "error";
    result.error = error instanceof ConnectorError ? error.message : "Error inesperado al procesar la fuente.";
    if (!(error instanceof ConnectorError)) console.error("[ingest]", row.id, error);
  }
  result.limits = limits;

  const { data: written, error } = await admin.rpc("finish_source_run", {
    p_source_id: row.id,
    p_lease_id: runId,
    p_state: {
      status: result.status,
      covered_until: next?.coveredUntil ?? null,
      cursor: next ? (next.cursor as Json) : null,
      error: result.error ?? null,
    },
    p_run: {
      run_id: runId,
      trigger,
      started_at: startedAt.toISOString(),
      fetched: result.fetched,
      inserted: result.inserted,
      updated: result.updated,
      duplicates: result.duplicates,
      unmatched: result.unmatched,
      window_from: plan.since.toISOString(),
      window_to: plan.until.toISOString(),
      complete: result.complete ?? null,
      limits: limits as unknown as Json,
      gap_from: gap?.from ?? null,
      gap_to: gap?.to ?? null,
    },
  });
  if (error) console.error("[ingest] finish:", row.id, error.message);
  else if (!written) console.warn("[ingest] lease lost, state not written:", row.id);

  return result;
}

/** Resolves authors (verified or pseudonymous), inserts new mentions and refreshes metrics of known ones. */
async function storeMentions(
  admin: Admin,
  row: SourceRow,
  mentions: Assigned[],
): Promise<{ inserted: number; updated: number; unchanged: number }> {
  const totals = { inserted: 0, updated: 0, unchanged: 0 };
  if (mentions.length === 0) return totals;

  const authors = new Map<string, AuthorRef>();
  for (const m of mentions) if (m.author) authors.set(`${m.author.platform}:${m.author.handle.trim().slice(0, 200)}`, m.author);
  const authorIds = new Map<string, string>();
  if (authors.size) {
    // The catalog of verified authors and the source's own outlet decide who is
    // media or a public figure; everyone else is kept only as a pseudonym.
    const { data, error } = await admin.rpc("upsert_authors", {
      p_org_id: row.org_id,
      p_source_id: row.id,
      p_rows: [...authors.values()].map((a) => ({
        platform: a.platform,
        handle: a.handle.trim().slice(0, 200),
        display_name: a.vouched ? (a.displayName?.slice(0, 200) ?? null) : null,
        followers: a.vouched ? a.followers : null,
        kind: a.kind,
        vouched: a.vouched,
      })) as unknown as Json,
    });
    if (error) throw new Error(`authors: ${error.message}`);
    for (const a of data ?? []) authorIds.set(`${a.platform}:${a.handle}`, a.author_id);
  }

  for (let i = 0; i < mentions.length; i += INSERT_CHUNK) {
    const chunk = mentions.slice(i, i + INSERT_CHUNK).map((m) => ({
      external_id: m.externalId,
      url: m.url,
      text: m.text,
      published_at: m.publishedAt,
      author_id: m.author ? (authorIds.get(`${m.author.platform}:${m.author.handle.trim().slice(0, 200)}`) ?? null) : null,
      metrics: m.metrics,
      // The exact query version that captured it; kept when the item reappears.
      query_id: m.queryId,
    }));
    const { data, error } = await admin.rpc("ingest_mentions", { p_org_id: row.org_id, p_source_id: row.id, p_rows: chunk as unknown as Json });
    if (error) throw new Error(`mentions: ${error.message}`);
    const counts = data as { inserted: number; updated: number; unchanged: number };
    totals.inserted += counts.inserted;
    totals.updated += counts.updated;
    totals.unchanged += counts.unchanged;
  }
  return totals;
}

async function logWorkerRuns(
  admin: Admin,
  runId: string,
  trigger: "cron" | "manual",
  startedAt: string,
  results: SourceRunResult[],
  orgOf: Map<string, string>,
) {
  const byOrg = new Map<string, SourceRunResult[]>();
  for (const r of results) {
    const org = orgOf.get(r.sourceId);
    if (org) byOrg.set(org, [...(byOrg.get(org) ?? []), r]);
  }
  if (!byOrg.size) return;
  const rows = [...byOrg].map(([orgId, list]) => {
    const sum = (k: "fetched" | "inserted" | "updated" | "duplicates" | "unmatched") => list.reduce((n, r) => n + r[k], 0);
    const count = (s: SourceRunResult["status"]) => list.filter((r) => r.status === s).length;
    return {
      run_id: runId,
      kind: "ingest",
      trigger,
      org_id: orgId,
      status: count("error") === list.length ? "error" : count("ok") === list.length ? "ok" : "partial",
      started_at: startedAt,
      counters: {
        sources: list.length,
        ok: count("ok"),
        partial: count("partial"),
        error: count("error"),
        skipped: count("skipped"),
        fetched: sum("fetched"),
        inserted: sum("inserted"),
        updated: sum("updated"),
        duplicates: sum("duplicates"),
        unmatched: sum("unmatched"),
      },
    };
  });
  const { error } = await admin.from("worker_runs").insert(rows);
  if (error) console.error("[ingest] worker_runs:", error.message);
}

/** Persisted "the job ran" mark read by the health page; per-source failures live in the sources themselves. */
async function heartbeat(admin: Admin, phase: "start" | "finish", error?: string) {
  const { error: e } = await admin.rpc("record_heartbeat", { p_kind: "ingest", p_phase: phase, p_error: error });
  if (e) console.error("[ingest] heartbeat:", e.message);
}
