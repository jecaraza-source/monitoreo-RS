import "server-only";
import { CONNECTORS, type SourceType } from "@/lib/connectors";
import type { Member } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/** What the client needs to know about each connector (the connectors themselves are server-only). */
export type ConnectorInfo = {
  type: SourceType;
  label: string;
  enabled: boolean;
  requiresSecret: boolean;
  defaultRequireMatch: boolean;
};

export function connectorInfo(): ConnectorInfo[] {
  return Object.values(CONNECTORS).map(({ type, label, enabled, requiresSecret, defaultRequireMatch }) => ({
    type,
    label,
    enabled,
    requiresSecret,
    defaultRequireMatch,
  }));
}

export type SourceView = {
  id: string;
  name: string;
  type: SourceType;
  config: Record<string, unknown>;
  isActive: boolean;
  hasSecret: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
  /** Everything published up to here was read (gaps are reported in the runs). */
  coveredUntil: string | null;
  /** A window left unfinished by a cap is being read before newer items. */
  catchingUp: boolean;
};

export type RunView = {
  id: string;
  sourceName: string;
  trigger: "cron" | "manual";
  status: "ok" | "partial" | "error";
  startedAt: string;
  fetched: number;
  inserted: number;
  updated: number;
  duplicates: number;
  unmatched: number;
  error: string | null;
  complete: boolean | null;
  limits: { kind: string; detail: string }[];
  gap: { from: string; to: string } | null;
};

export type FailureView = {
  id: string;
  kind: "classify" | "ingest";
  what: string;
  attempts: number;
  error: string | null;
  lastFailedAt: string;
};

export async function getSources(member: Member): Promise<SourceView[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sources")
    .select("id, name, type, config, is_active, has_secret, last_run_at, last_success_at, last_error, last_error_at, consecutive_failures, covered_until, cursor")
    .eq("org_id", member.orgId)
    // Newest first; sources added together (same instant) by name.
    .order("created_at", { ascending: false })
    .order("name");
  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    config: (s.config ?? {}) as Record<string, unknown>,
    isActive: s.is_active,
    hasSecret: s.has_secret,
    lastRunAt: s.last_run_at,
    lastSuccessAt: s.last_success_at,
    lastError: s.last_error,
    lastErrorAt: s.last_error_at,
    consecutiveFailures: s.consecutive_failures,
    coveredUntil: s.covered_until,
    catchingUp: Boolean((s.cursor as Record<string, unknown> | null)?.backfill),
  }));
}

export async function getRecentRuns(member: Member, limit = 20): Promise<RunView[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ingest_runs")
    .select("id, trigger, status, started_at, fetched, inserted, updated, duplicates, unmatched, error, complete, limits, gap_from, gap_to, sources(name)")
    .eq("org_id", member.orgId)
    .order("started_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => ({
    id: r.id,
    sourceName: r.sources?.name ?? "—",
    trigger: r.trigger as RunView["trigger"],
    status: r.status as RunView["status"],
    startedAt: r.started_at,
    fetched: r.fetched,
    inserted: r.inserted,
    updated: r.updated,
    duplicates: r.duplicates,
    unmatched: r.unmatched,
    error: r.error,
    complete: r.complete,
    limits: Array.isArray(r.limits) ? (r.limits as RunView["limits"]) : [],
    gap: r.gap_from && r.gap_to ? { from: r.gap_from, to: r.gap_to } : null,
  }));
}

/** Open entries of the review queue (admin and comunicacion; RLS hides it from the rest). */
export async function getOpenFailures(member: Member, limit = 50): Promise<FailureView[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("pipeline_failures")
    .select("id, kind, attempts, error, last_failed_at, mentions(text), sources(name)")
    .eq("org_id", member.orgId)
    .is("resolved_at", null)
    .order("last_failed_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((f) => ({
    id: f.id,
    kind: f.kind as FailureView["kind"],
    what: f.kind === "ingest" ? (f.sources?.name ?? "Fuente") : (f.mentions?.text ?? "Mención").slice(0, 160),
    attempts: f.attempts,
    error: f.error,
    lastFailedAt: f.last_failed_at,
  }));
}
