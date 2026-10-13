// Coverage of a source over time: which window each run reads and how far the
// watermark (sources.covered_until) may move. Pure, so it is tested on its own.
//
// Rule: covered_until only moves over windows read to the end. When a newest-
// first provider stops early (page cap, time, an error after some pages), the
// unread part (since, resumeUntil] is kept in the cursor as a backfill and the
// next run reads it before moving on; covered_until jumps to the end of the
// original window once the backfill completes.
import type { CoverageLimit, FetchResult } from "../connectors/types.ts";

export const BACKFILL_MS = 3 * 86_400_000;
/** Late-indexed items near the boundary; dedupe absorbs the overlap. */
export const OVERLAP_MS = 15 * 60_000;
/** Same-second ties larger than a run can read: the stuck second is skipped and reported. */
const TIE_STEP_MS = 1000;

export type Backfill = { since: string; until: string; coverTo: string };

export type CoverageState = { coveredUntil: string | null; backfill: Backfill | null };

export type Plan = { mode: "head" | "backfill"; since: Date; until: Date };

export function readBackfill(cursor: Record<string, unknown>): Backfill | null {
  const b = cursor.backfill as Partial<Backfill> | undefined;
  return b && typeof b.since === "string" && typeof b.until === "string" && typeof b.coverTo === "string"
    ? { since: b.since, until: b.until, coverTo: b.coverTo }
    : null;
}

export function planWindow(state: CoverageState, now: Date): Plan {
  if (state.backfill) return { mode: "backfill", since: new Date(state.backfill.since), until: new Date(state.backfill.until) };
  const base = state.coveredUntil ? Date.parse(state.coveredUntil) : now.getTime() - BACKFILL_MS;
  return { mode: "head", since: new Date(base - OVERLAP_MS), until: now };
}

export type Outcome = {
  state: CoverageState;
  /** Unrecoverable range to report (provider rolled past it, or a stuck same-second tie). */
  gap: { from: string; to: string } | null;
  limits: CoverageLimit[];
};

export function applyResult(state: CoverageState, plan: Plan, result: Pick<FetchResult, "complete" | "resumeUntil" | "gap">): Outcome {
  const limits: CoverageLimit[] = [];
  // A first read has no promise to keep: a feed newer than the initial backfill is not a gap.
  const gap = result.gap && state.coveredUntil ? result.gap : null;

  if (result.complete) {
    const coveredUntil = plan.mode === "backfill" ? state.backfill!.coverTo : plan.until.toISOString();
    return { state: { coveredUntil: later(state.coveredUntil, coveredUntil), backfill: null }, gap, limits };
  }

  const coverTo = plan.mode === "backfill" ? state.backfill!.coverTo : plan.until.toISOString();
  let resume = result.resumeUntil ? Date.parse(result.resumeUntil) : plan.until.getTime();
  let tieGap: Outcome["gap"] = null;
  if (resume >= plan.until.getTime()) {
    // No progress: more items share the newest second than one run can read.
    resume = plan.until.getTime() - TIE_STEP_MS;
    tieGap = { from: new Date(resume).toISOString(), to: plan.until.toISOString() };
    limits.push({ kind: "tie", detail: `Demasiados elementos con la misma hora (${plan.until.toISOString()}); ese segundo quedó parcial.` });
  }
  if (resume <= plan.since.getTime()) {
    // The rest of the window is just the overlap: nothing left to read.
    return { state: { coveredUntil: later(state.coveredUntil, coverTo), backfill: null }, gap: gap ?? tieGap, limits };
  }
  return {
    state: {
      coveredUntil: state.coveredUntil,
      backfill: { since: plan.since.toISOString(), until: new Date(resume).toISOString(), coverTo },
    },
    gap: gap ?? tieGap,
    limits,
  };
}

function later(a: string | null, b: string): string {
  return a && Date.parse(a) > Date.parse(b) ? a : b;
}
