import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reportPeriod, scheduleDue, scheduledPeriod } from "./period.ts";

describe("report periods", () => {
  it("weekly covers the 7 days ending on the chosen day, against the 7 before", () => {
    const p = reportPeriod("weekly", "2026-10-08");
    assert.deepEqual([p.startDay, p.endDay, p.prevStartDay, p.prevEndDay], ["2026-10-02", "2026-10-08", "2026-09-25", "2026-10-01"]);
    assert.equal(p.from.toISOString(), "2026-10-02T06:00:00.000Z");
    assert.equal(p.to.toISOString(), "2026-10-09T06:00:00.000Z");
    assert.equal(p.bucket, "day");
  });

  it("daily is one Mexico City day by the hour", () => {
    const p = reportPeriod("daily", "2026-10-08");
    assert.deepEqual([p.startDay, p.prevStartDay, p.bucket], ["2026-10-08", "2026-10-07", "hour"]);
    assert.equal(p.label, "8 de octubre de 2026");
  });

  it("monthly is the calendar month to date, against the same span of the previous month", () => {
    const full = reportPeriod("monthly", "2026-09-30");
    assert.deepEqual([full.startDay, full.prevStartDay, full.prevEndDay, full.label], ["2026-09-01", "2026-08-01", "2026-08-30", "septiembre de 2026"]);
    const partial = reportPeriod("monthly", "2026-10-09");
    assert.deepEqual([partial.prevStartDay, partial.prevEndDay], ["2026-09-01", "2026-09-09"]);
    assert.equal(partial.label, "octubre de 2026 (al 9 de octubre)");
    assert.equal(reportPeriod("monthly", "2026-03-31").prevEndDay, "2026-02-28");
  });

  it("schedules run daily, on Mondays and on the 1st, for the period just closed", () => {
    assert.equal(scheduleDue("weekly", "2026-10-12"), true);
    assert.equal(scheduleDue("weekly", "2026-10-13"), false);
    assert.equal(scheduleDue("monthly", "2026-11-01"), true);
    assert.deepEqual([scheduledPeriod("weekly", "2026-10-12").startDay, scheduledPeriod("weekly", "2026-10-12").endDay], ["2026-10-05", "2026-10-11"]);
    assert.equal(scheduledPeriod("monthly", "2026-11-01").label, "octubre de 2026");
  });
});
