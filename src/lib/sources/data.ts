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
};

export type RunView = {
  id: string;
  sourceName: string;
  trigger: "cron" | "manual";
  status: "ok" | "error";
  startedAt: string;
  fetched: number;
  inserted: number;
  duplicates: number;
  unmatched: number;
  error: string | null;
};

export async function getSources(member: Member): Promise<SourceView[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sources")
    .select("id, name, type, config, is_active, has_secret, last_run_at, last_success_at, last_error, last_error_at, consecutive_failures")
    .eq("org_id", member.orgId)
    .order("created_at");
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
  }));
}

export async function getRecentRuns(member: Member, limit = 20): Promise<RunView[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ingest_runs")
    .select("id, trigger, status, started_at, fetched, inserted, duplicates, unmatched, error, sources(name)")
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
    duplicates: r.duplicates,
    unmatched: r.unmatched,
    error: r.error,
  }));
}
