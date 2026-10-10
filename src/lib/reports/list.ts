import "server-only";
import type { Member } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { REPORT_SELECT, toReport, type ReportRow } from "./data";
import type { ReportKind } from "./period";

export type ReportSchedule = { period: ReportKind; recipients: string[]; autoApprove: boolean; isActive: boolean; lastRunAt: string | null };

export async function getReports(member: Member): Promise<{
  reports: ReportRow[];
  schedules: ReportSchedule[];
  brand: { primary: string; accent: string };
}> {
  const supabase = await createClient();
  const [reports, schedules, org] = await Promise.all([
    supabase.from("reports").select(REPORT_SELECT).eq("org_id", member.orgId).order("created_at", { ascending: false }).limit(60),
    supabase.from("report_schedules").select("period, recipients, auto_approve, is_active, last_run_at").eq("org_id", member.orgId),
    supabase.from("organizations").select("brand_primary, brand_accent").eq("id", member.orgId).single(),
  ]);
  if (reports.error) throw new Error(`No se pudieron cargar los reportes: ${reports.error.message}`);
  return {
    reports: (reports.data ?? []).map((r) => toReport(r as never)),
    schedules: (schedules.data ?? []).map((s) => ({
      period: s.period,
      recipients: s.recipients,
      autoApprove: s.auto_approve,
      isActive: s.is_active,
      lastRunAt: s.last_run_at,
    })),
    brand: { primary: org.data?.brand_primary ?? "#032a50", accent: org.data?.brand_accent ?? "#36c6c0" },
  };
}

export async function getReport(member: Member, id: string): Promise<ReportRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("reports").select(REPORT_SELECT).eq("org_id", member.orgId).eq("id", id).maybeSingle();
  return data ? toReport(data as never) : null;
}
