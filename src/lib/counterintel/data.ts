import "server-only";
import type { Member } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { parseOverview, type CiKind, type CiOverview, type CiSeverity, type CiStatus } from "./model";

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
  if (error) throw new Error(`No se pudo cargar la Oficina de Contrainteligencia: ${error.message}`);
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
