import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { processReportJobs, type JobDeps, type JobStage, type ReportJob } from "./jobs.ts";

/** A job store like claim_report_jobs / advance_report_job, plus counters of the side effects. */
function fakeDeps(job: Partial<ReportJob>, faults: Partial<Record<"draft" | "render" | "enqueueSend", number>> = {}) {
  const state: ReportJob & { leased: boolean; attempts: number } = {
    id: "job-1",
    org_id: "org",
    schedule_id: null,
    kind: "daily",
    period_start: "2026-11-30",
    period_end: "2026-11-30",
    stage: "queued",
    report_id: null,
    auto_approve: true,
    recipients: ["cabildo@monitoreo.test"],
    leased: false,
    attempts: 0,
    ...job,
  };
  const calls = { draft: 0, approve: 0, render: 0, enqueueSend: 0, reports: new Set<string>() };
  let delivered: "pending" | "sent" | "failed" = "pending";
  const fail = (k: keyof typeof faults) => {
    if (faults[k]) {
      faults[k]!--;
      throw new Error(`${k} falló`);
    }
  };
  const deps: JobDeps = {
    async claim() {
      if (state.leased || ["done", "awaiting_approval", "failed"].includes(state.stage)) return [];
      state.leased = true;
      return [{ ...state }];
    },
    async advance(_job, _worker, to: JobStage, opts = {}) {
      if (opts.error) {
        state.attempts++;
        state.leased = false;
        return state.stage;
      }
      state.stage = to;
      if (opts.reportId) state.report_id = opts.reportId;
      if (opts.release || ["done", "awaiting_approval", "failed"].includes(to)) state.leased = false;
      return to;
    },
    async draft(j) {
      calls.draft++;
      fail("draft");
      // Like reports.job_id unique: the job's report, never a second one.
      const id = `report-of-${j.id}`;
      calls.reports.add(id);
      return id;
    },
    async approve() {
      calls.approve++;
    },
    async render() {
      calls.render++;
      fail("render");
    },
    async enqueueSend() {
      calls.enqueueSend++;
      fail("enqueueSend");
    },
    async delivery() {
      return delivered;
    },
  };
  return { deps, state, calls, deliver: (s: typeof delivered) => (delivered = s) };
}

describe("report jobs", () => {
  it("goes stage by stage and is done only after the emails were accepted", async () => {
    const f = fakeDeps({});
    const first = await processReportJobs({ deps: f.deps, worker: "cron" });
    assert.equal(first[0].to, "sending", "waits for the outbox");
    assert.equal(f.state.stage, "sending");
    f.deliver("sent");
    const second = await processReportJobs({ deps: f.deps, worker: "cron" });
    assert.equal(second[0].to, "done");
    assert.deepEqual([f.calls.draft, f.calls.approve, f.calls.render, f.calls.enqueueSend], [1, 1, 1, 1]);
  });

  it("without explicit auto-approval it waits for a person and sends nothing", async () => {
    const f = fakeDeps({ auto_approve: false });
    await processReportJobs({ deps: f.deps, worker: "cron" });
    assert.equal(f.state.stage, "awaiting_approval");
    assert.deepEqual([f.calls.approve, f.calls.render, f.calls.enqueueSend], [0, 0, 0]);
  });

  it("an AI failure keeps the stage; the retry drafts once", async () => {
    const f = fakeDeps({}, { draft: 1 });
    const first = await processReportJobs({ deps: f.deps, worker: "cron" });
    assert.equal(first[0].error, "draft falló");
    assert.equal(f.state.stage, "queued");
    await processReportJobs({ deps: f.deps, worker: "cron" });
    assert.equal(f.state.stage, "sending");
    assert.equal(f.calls.reports.size, 1, "one report for the job");
  });

  it("a Storage failure resumes at the PDF, without drafting again", async () => {
    const f = fakeDeps({}, { render: 1 });
    await processReportJobs({ deps: f.deps, worker: "cron" });
    assert.equal(f.state.stage, "approved");
    await processReportJobs({ deps: f.deps, worker: "cron" });
    assert.equal(f.state.stage, "sending");
    assert.deepEqual([f.calls.draft, f.calls.render], [1, 2]);
  });

  it("an email that will not be delivered fails the job visibly", async () => {
    const f = fakeDeps({ stage: "sending", report_id: "r" });
    f.deliver("failed");
    const runs = await processReportJobs({ deps: f.deps, worker: "cron" });
    assert.equal(runs[0].to, "failed");
  });

  it("out of time: released at the saved stage, resumed by the next run", async () => {
    const f = fakeDeps({});
    let t = 0;
    // Each stage "takes" 100 ms; budget 150 ms.
    const runs = await processReportJobs({ deps: f.deps, worker: "cron", budgetMs: 150, clock: () => (t += 100) });
    assert.equal(runs[0].error, "Sin tiempo en esta corrida; continúa en la siguiente.");
    assert.equal(f.state.stage, "drafted");
    assert.equal(f.state.leased, false);
    await processReportJobs({ deps: f.deps, worker: "cron" });
    assert.equal(f.state.stage, "sending");
    assert.equal(f.calls.draft, 1);
  });
});
