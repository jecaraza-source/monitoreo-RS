import "server-only";
import { toMxDay } from "@/lib/dashboard/period";
import { runOutbox, workerId } from "@/lib/outbox/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createReportDraft, REPORT_SELECT, toReport } from "./data";
import { queueReportEmails, settleReportDelivery, storeReportPdf } from "./deliver";
import { processReportJobs, type JobDeps, type JobRun, type ReportJob } from "./jobs";
import { scheduleDue, scheduledPeriod, type ReportKind } from "./period";

type Admin = ReturnType<typeof createAdminClient>;

export type ScheduleRun = { queued: { orgId: string; period: ReportKind; jobId: string; created: boolean }[]; jobs: JobRun[] };

/** Queues today's due reports as jobs (one per org, kind and period, even with concurrent crons). */
export async function enqueueDueReports(admin: Admin, now = new Date()): Promise<ScheduleRun["queued"]> {
  const today = toMxDay(now);
  const { data, error } = await admin.from("report_schedules").select("id, org_id, period, recipients, auto_approve").eq("is_active", true);
  if (error) throw new Error(`No se pudieron leer las programaciones: ${error.message}`);
  const queued: ScheduleRun["queued"] = [];
  for (const s of data ?? []) {
    const kind = s.period as ReportKind;
    if (!scheduleDue(kind, today)) continue;
    const period = scheduledPeriod(kind, today);
    const { data: job, error: jobError } = await admin.rpc("enqueue_report_job", {
      p_org_id: s.org_id,
      p_schedule_id: s.id,
      p_kind: kind,
      p_start: period.startDay,
      p_end: period.endDay,
      p_auto_approve: s.auto_approve === true,
      p_recipients: s.recipients,
    });
    if (jobError) {
      console.error("[reports] enqueue", s.id, jobError.message);
      continue;
    }
    const r = job as { id: string; created: boolean };
    queued.push({ orgId: s.org_id, period: kind, jobId: r.id, created: r.created });
    // Informational only: the job is the source of truth.
    await admin.from("report_schedules").update({ last_run_at: now.toISOString() }).eq("id", s.id);
  }
  return queued;
}

/** The job stages against the database, Claude, Storage and the outbox. */
export function serverJobDeps(admin: Admin): JobDeps {
  return {
    async claim(worker, limit) {
      const { data, error } = await admin.rpc("claim_report_jobs", { p_worker: worker, p_limit: limit });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ReportJob[];
    },
    async advance(job, worker, to, opts = {}) {
      const { data, error } = await admin.rpc("advance_report_job", {
        p_id: job.id,
        p_worker: worker,
        p_to_stage: to,
        p_report_id: opts.reportId,
        p_error: opts.error,
        p_release: opts.release ?? false,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    async draft(job) {
      // A previous run may have saved the draft and died before recording it.
      const existing = await admin.from("reports").select("id").eq("job_id", job.id).maybeSingle();
      if (existing.data) return existing.data.id;
      try {
        return await createReportDraft(admin, {
          orgId: job.org_id,
          kind: job.kind,
          endDay: job.period_end,
          recipients: job.recipients,
          scheduleId: job.schedule_id,
          jobId: job.id,
        });
      } catch (error) {
        const again = await admin.from("reports").select("id").eq("job_id", job.id).maybeSingle();
        if (again.data) return again.data.id;
        throw error;
      }
    },
    async approve(reportId) {
      const { error } = await admin.from("reports").update({ status: "approved" }).eq("id", reportId).eq("status", "draft");
      if (error) throw new Error(`No se pudo autoaprobar: ${error.message}`);
    },
    async render(reportId) {
      await storeReportPdf(reportId);
    },
    async enqueueSend(job, reportId) {
      if (!process.env.RESEND_API_KEY || !(process.env.REPORTS_FROM_EMAIL || process.env.ALERTS_FROM_EMAIL)) {
        throw new Error("Correo sin configurar (RESEND_API_KEY y remitente).");
      }
      const { data, error } = await admin.from("reports").select(REPORT_SELECT).eq("id", reportId).single();
      if (error || !data) throw new Error(`No se encontró el reporte: ${error?.message}`);
      await queueReportEmails(admin, toReport(data as never), job.recipients, `job-${job.id}`);
    },
    async delivery(reportId) {
      const { data } = await admin.from("outbox").select("id").eq("report_id", reportId).like("idempotency_key", `report:${reportId}:job-%`);
      const ids = (data ?? []).map((r) => r.id);
      if (!ids.length) return "sent";
      const result = await settleReportDelivery(reportId, ids);
      return result.status === "queued" ? "pending" : result.status === "sent" ? "sent" : "failed";
    },
  };
}

/** Advances due jobs within a time budget (also called by the notify cron to resume them). */
export async function runReportJobs(admin: Admin, opts: { limit?: number; budgetMs?: number } = {}): Promise<JobRun[]> {
  return processReportJobs({ deps: serverJobDeps(admin), worker: workerId("reports"), limit: opts.limit ?? 3, budgetMs: opts.budgetMs ?? 200_000 });
}

/**
 * Daily cron: queue the due jobs, advance them, send their emails and settle.
 * A person approves the reports unless the schedule auto-approves explicitly.
 */
export async function runReportSchedules(now = new Date()): Promise<ScheduleRun> {
  const admin = createAdminClient();
  const queued = await enqueueDueReports(admin, now);
  const jobs = await runReportJobs(admin, { budgetMs: 200_000 });
  await runOutbox(admin, { budgetMs: 40_000 });
  // Jobs waiting for their emails can finish now.
  jobs.push(...(await runReportJobs(admin, { budgetMs: 30_000 })));
  return { queued, jobs };
}
