// Scheduled reports as jobs: one per org, kind and period (unique in the
// database), advanced stage by stage under a lease. Every stage is saved
// before the next starts, so an interrupted run (AI, Storage or email
// failure, timeout, crash) resumes where it stopped. Nothing is marked sent
// until its emails were accepted. Pure: dependencies are injected.

export type JobStage = "queued" | "drafted" | "approved" | "rendered" | "sending" | "done" | "awaiting_approval" | "failed";

export type ReportJob = {
  id: string;
  org_id: string;
  schedule_id: string | null;
  kind: "daily" | "weekly" | "monthly";
  period_start: string;
  period_end: string;
  stage: JobStage;
  report_id: string | null;
  auto_approve: boolean;
  recipients: string[];
};

export interface JobDeps {
  claim(worker: string, limit: number): Promise<ReportJob[]>;
  /** Records a stage (or an error, which keeps the stage for a retry). Returns the stage or "stale". */
  advance(job: ReportJob, worker: string, to: JobStage, opts?: { reportId?: string; error?: string; release?: boolean }): Promise<string>;
  /** The job's report: the existing one, or a new draft (AI). */
  draft(job: ReportJob): Promise<string>;
  /** Server approval, only for jobs whose schedule asked for it explicitly. */
  approve(reportId: string): Promise<void>;
  /** Renders and stores the PDF. */
  render(reportId: string): Promise<void>;
  /** Queues one email per recipient in the outbox (idempotent). */
  enqueueSend(job: ReportJob, reportId: string): Promise<void>;
  /** sent: all accepted (the report is marked sent); failed: some will not be; pending: still in the outbox. */
  delivery(reportId: string): Promise<"pending" | "sent" | "failed">;
}

export type JobRun = { jobId: string; from: JobStage; to: string; error?: string };

/** One step of a job; returns the next stage. Throws on failure. */
async function step(deps: JobDeps, job: ReportJob): Promise<{ to: JobStage; reportId?: string; wait?: boolean }> {
  switch (job.stage) {
    case "queued":
      return { to: "drafted", reportId: await deps.draft(job) };
    case "drafted":
      if (!job.auto_approve) return { to: "awaiting_approval" };
      await deps.approve(job.report_id!);
      return { to: "approved" };
    case "approved":
      await deps.render(job.report_id!);
      return { to: "rendered" };
    case "rendered":
      await deps.enqueueSend(job, job.report_id!);
      return { to: "sending" };
    case "sending": {
      const state = await deps.delivery(job.report_id!);
      if (state === "sent") return { to: "done" };
      if (state === "failed") return { to: "failed" };
      return { to: "sending", wait: true };
    }
    default:
      return { to: job.stage, wait: true };
  }
}

export async function processReportJobs(opts: {
  deps: JobDeps;
  worker: string;
  /** Jobs per run. */
  limit?: number;
  /** Stop starting new stages after this long. */
  budgetMs?: number;
  clock?: () => number;
}): Promise<JobRun[]> {
  const clock = opts.clock ?? Date.now;
  const started = clock();
  const budget = opts.budgetMs ?? 240_000;
  const runs: JobRun[] = [];
  const jobs = await opts.deps.claim(opts.worker, opts.limit ?? 3);
  for (const claimed of jobs) {
    let job = claimed;
    const from = job.stage;
    for (;;) {
      if (clock() - started >= budget) {
        // Out of time: release it at the saved stage; the next run resumes.
        await opts.deps.advance(job, opts.worker, job.stage, { release: true });
        runs.push({ jobId: job.id, from, to: job.stage, error: "Sin tiempo en esta corrida; continúa en la siguiente." });
        break;
      }
      let next: Awaited<ReturnType<typeof step>>;
      try {
        next = await step(opts.deps, job);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const to = await opts.deps.advance(job, opts.worker, job.stage, { error: message });
        runs.push({ jobId: job.id, from, to, error: message });
        break;
      }
      const to = await opts.deps.advance(job, opts.worker, next.to, { reportId: next.reportId, release: next.wait });
      if (to === "stale") {
        runs.push({ jobId: job.id, from, to, error: "Otro proceso tomó el trabajo." });
        break;
      }
      job = { ...job, stage: next.to, report_id: next.reportId ?? job.report_id };
      if (next.wait || ["done", "awaiting_approval", "failed"].includes(next.to)) {
        runs.push({ jobId: job.id, from, to: next.to });
        break;
      }
    }
  }
  return runs;
}
