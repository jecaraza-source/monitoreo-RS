import "server-only";
import { CONNECTORS } from "@/lib/connectors";
import type { Member } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { HealthSnapshot } from "./model";

/** Persisted health snapshot of the member's org (public.monitor_health checks the role). */
export async function getHealth(member: Member): Promise<HealthSnapshot> {
  const supabase = await createClient();
  const [{ data, error }, corrections] = await Promise.all([
    supabase.rpc("monitor_health", { p_org_id: member.orgId }),
    supabase.rpc("stats_invalidation_status", { p_org_id: member.orgId }),
  ]);
  if (error || !data) throw new Error(`No se pudo leer la salud del monitoreo: ${error?.message ?? "sin datos"}`);
  return { ...(data as unknown as HealthSnapshot), corrections: (corrections.data ?? null) as HealthSnapshot["corrections"] };
}

export const connectorEnabled = (type: string): boolean =>
  Object.values(CONNECTORS).find((c) => c.type === type)?.enabled ?? false;

export const PERIODS = { "24h": 1, "7d": 7, "30d": 30 } as const;
export type Period = keyof typeof PERIODS;
export const RUN_STATUSES = ["ok", "partial", "error"] as const;
export const TRIGGERS = ["cron", "manual"] as const;

export type RunFilters = {
  source: string | null;
  status: (typeof RUN_STATUSES)[number] | null;
  trigger: (typeof TRIGGERS)[number] | null;
  period: Period;
  limit: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Filters from the URL; anything unexpected falls back to the default. */
export function parseRunFilters(params: Record<string, string | string[] | undefined>): RunFilters {
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : null);
  const status = one("estado");
  const trigger = one("origen");
  const period = one("periodo");
  const limit = Number(one("ver") ?? 50);
  return {
    source: one("fuente") && UUID.test(one("fuente")!) ? one("fuente") : null,
    status: (RUN_STATUSES as readonly string[]).includes(status ?? "") ? (status as RunFilters["status"]) : null,
    trigger: (TRIGGERS as readonly string[]).includes(trigger ?? "") ? (trigger as RunFilters["trigger"]) : null,
    period: period && period in PERIODS ? (period as Period) : "7d",
    limit: Number.isFinite(limit) ? Math.min(Math.max(Math.round(limit), 50), 500) : 50,
  };
}

export type RunDetail = {
  id: string;
  runId: string | null;
  sourceId: string;
  sourceName: string;
  sourceType: string;
  trigger: "cron" | "manual";
  status: "ok" | "partial" | "error";
  startedAt: string;
  finishedAt: string;
  fetched: number;
  inserted: number;
  updated: number;
  duplicates: number;
  unmatched: number;
  error: string | null;
  complete: boolean | null;
  windowFrom: string | null;
  windowTo: string | null;
  coveredUntil: string | null;
  limits: { kind: string; detail: string }[];
  gap: { from: string; to: string } | null;
};

export async function getRuns(member: Member, f: RunFilters): Promise<{ runs: RunDetail[]; more: boolean }> {
  const supabase = await createClient();
  const since = new Date(Date.now() - PERIODS[f.period] * 86_400_000).toISOString();
  let query = supabase
    .from("ingest_runs")
    .select(
      "id, run_id, source_id, trigger, status, started_at, finished_at, fetched, inserted, updated, duplicates, unmatched, error, complete, window_from, window_to, covered_until, limits, gap_from, gap_to, sources(name, type)",
    )
    .eq("org_id", member.orgId)
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(f.limit + 1);
  if (f.source) query = query.eq("source_id", f.source);
  if (f.status) query = query.eq("status", f.status);
  if (f.trigger) query = query.eq("trigger", f.trigger);
  const { data, error } = await query;
  if (error) throw new Error(`No se pudieron leer las corridas: ${error.message}`);
  const rows = data ?? [];
  return {
    more: rows.length > f.limit,
    runs: rows.slice(0, f.limit).map((r) => ({
      id: r.id,
      runId: r.run_id,
      sourceId: r.source_id,
      sourceName: r.sources?.name ?? "—",
      sourceType: r.sources?.type ?? "",
      trigger: r.trigger as RunDetail["trigger"],
      status: r.status as RunDetail["status"],
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      fetched: r.fetched,
      inserted: r.inserted,
      updated: r.updated,
      duplicates: r.duplicates,
      unmatched: r.unmatched,
      error: r.error,
      complete: r.complete,
      windowFrom: r.window_from,
      windowTo: r.window_to,
      coveredUntil: r.covered_until,
      limits: Array.isArray(r.limits) ? (r.limits as RunDetail["limits"]) : [],
      gap: r.gap_from && r.gap_to ? { from: r.gap_from, to: r.gap_to } : null,
    })),
  };
}
