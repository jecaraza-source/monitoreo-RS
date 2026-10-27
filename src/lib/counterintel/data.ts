import "server-only";
import type { Member } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { parseOverview, type CiKind, type CiOverview, type CiSeverity, type CiStatus } from "./model";
import { providerEnv, type CheckStatus, type Provider } from "./providers";

export type CiReport = {
  id: string;
  kind: CiKind;
  title: string;
  summary: string;
  severity: CiSeverity;
  status: CiStatus;
  indicators: string[];
  mentionIds: string[];
  closedNote: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

/** Leads for the office over the last `days` (the database checks the grant and logs the consultation). */
export async function getOverview(member: Member, days: number): Promise<CiOverview> {
  const from = new Date(Date.now() - days * 86_400_000);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ci_overview", { p_org_id: member.orgId, p_from: from.toISOString() });
  if (error) throw new Error(`No se pudo cargar Radar Social: ${error.message}`);
  return parseOverview(data);
}

/** The office's register, open ones first (RLS shows it only to authorized members). */
export async function getReports(member: Member): Promise<CiReport[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ci_reports")
    .select("id, kind, title, summary, severity, status, indicators, mention_ids, closed_note, created_at, updated_at, closed_at")
    .eq("org_id", member.orgId)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`No se pudo cargar el registro: ${error.message}`);
  const rank: Record<CiStatus, number> = { open: 0, monitoring: 1, closed: 2 };
  return (data ?? [])
    .map((r) => ({
      id: r.id,
      kind: r.kind as CiKind,
      title: r.title,
      summary: r.summary,
      severity: r.severity,
      status: r.status as CiStatus,
      indicators: r.indicators,
      mentionIds: r.mention_ids,
      closedNote: r.closed_note,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      closedAt: r.closed_at,
    }))
    .sort((a, b) => rank[a.status] - rank[b.status]);
}

export type RadarSettings = { officialDomains: string[]; watchTerms: string[]; updatedAt: string | null };

export type RadarCheck = {
  id: string;
  reportId: string | null;
  provider: Provider;
  subject: string;
  status: CheckStatus;
  summary: string;
  details: Record<string, unknown>;
  checkedAt: string;
};

export async function getRadarSettings(member: Member): Promise<RadarSettings> {
  const supabase = await createClient();
  const { data } = await supabase.from("ci_settings").select("official_domains, watch_terms, updated_at").eq("org_id", member.orgId).maybeSingle();
  return { officialDomains: data?.official_domains ?? [], watchTerms: data?.watch_terms ?? [], updatedAt: data?.updated_at ?? null };
}

/**
 * Latest results: for each report, its most recent run (one row per indicator
 * and service); the latest certificate search per term; the last searches.
 */
export async function getRadarChecks(member: Member): Promise<{
  byReport: Map<string, RadarCheck[]>;
  lookalikes: RadarCheck[];
  searches: RadarCheck[];
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ci_checks")
    .select("id, report_id, provider, subject, status, summary, details, checked_at")
    .eq("org_id", member.orgId)
    .order("checked_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`No se pudieron cargar las consultas: ${error.message}`);
  const rows: RadarCheck[] = (data ?? []).map((r) => ({
    id: r.id,
    reportId: r.report_id,
    provider: r.provider as Provider,
    subject: r.subject,
    status: r.status as CheckStatus,
    summary: r.summary,
    details: (r.details ?? {}) as Record<string, unknown>,
    checkedAt: r.checked_at,
  }));
  const byReport = new Map<string, RadarCheck[]>();
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.reportId) continue;
    const key = `${r.reportId}|${r.provider}|${r.subject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    byReport.set(r.reportId, [...(byReport.get(r.reportId) ?? []), r]);
  }
  const terms = new Set<string>();
  const lookalikes = rows.filter((r) => r.provider === "crtsh" && !terms.has(r.subject) && terms.add(r.subject));
  const searches = rows.filter((r) => r.provider === "factcheck" || r.provider === "gdelt").slice(0, 5);
  return { byReport, lookalikes, searches };
}

/** Which services have their key on the server (names only, never values). */
export function radarConfigured(): Record<"urlhaus" | "safe_browsing" | "factcheck", boolean> {
  const env = providerEnv();
  return { urlhaus: Boolean(env.abuseChKey), safe_browsing: Boolean(env.safeBrowsingKey), factcheck: Boolean(env.factCheckKey) };
}
