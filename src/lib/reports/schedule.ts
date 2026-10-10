import "server-only";
import { toMxDay } from "@/lib/dashboard/period";
import { createAdminClient } from "@/lib/supabase/admin";
import { createReportDraft } from "./data";
import { sendReport } from "./deliver";
import { scheduleDue, scheduledPeriod, type ReportKind } from "./period";

export type ScheduleRun = { orgId: string; period: ReportKind; reportId?: string; status: "drafted" | "sent" | "skipped" | "error"; detail?: string };

/**
 * Daily cron: for each active schedule due today (Mexico City), drafts the
 * report of the period that just closed. With auto_approve it is approved and
 * emailed right away; otherwise it waits in /reportes for an editor.
 */
export async function runReportSchedules(now = new Date()): Promise<ScheduleRun[]> {
  const admin = createAdminClient();
  const today = toMxDay(now);
  const { data, error } = await admin
    .from("report_schedules")
    .select("id, org_id, period, recipients, auto_approve, last_run_at")
    .eq("is_active", true);
  if (error) throw new Error(`No se pudieron leer las programaciones: ${error.message}`);

  const runs: ScheduleRun[] = [];
  for (const s of data ?? []) {
    const kind = s.period as ReportKind;
    if (!scheduleDue(kind, today)) continue;
    // At most once per Mexico City day, even if the cron is retried.
    if (s.last_run_at && toMxDay(new Date(s.last_run_at)) === today) {
      runs.push({ orgId: s.org_id, period: kind, status: "skipped", detail: "Ya corrió hoy." });
      continue;
    }
    await admin.from("report_schedules").update({ last_run_at: now.toISOString() }).eq("id", s.id);
    try {
      const period = scheduledPeriod(kind, today);
      const reportId = await createReportDraft(admin, {
        orgId: s.org_id,
        kind,
        endDay: period.endDay,
        recipients: s.recipients,
        scheduleId: s.id,
      });
      if (!s.auto_approve) {
        runs.push({ orgId: s.org_id, period: kind, reportId, status: "drafted" });
        continue;
      }
      const { error: approveError } = await admin.from("reports").update({ status: "approved" }).eq("id", reportId);
      if (approveError) throw new Error(approveError.message);
      const result = await sendReport(reportId);
      runs.push({ orgId: s.org_id, period: kind, reportId, status: result.status === "sent" ? "sent" : "error", detail: result.detail });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error("[reports] schedule", s.id, detail);
      runs.push({ orgId: s.org_id, period: kind, status: "error", detail });
    }
  }
  return runs;
}
