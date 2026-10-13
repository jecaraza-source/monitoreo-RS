import { NextResponse, type NextRequest } from "next/server";
import { cronDisabledHere, isAuthorizedCron } from "@/lib/auth/cron";
import { runReportSchedules } from "@/lib/reports/schedule";

// Each scheduled report waits for Claude and renders a PDF.
export const maxDuration = 300;

/** Scheduled in vercel.json (13:00 UTC = 7:00 in Mexico City). Safe to run twice: one job per period. */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (cronDisabledHere()) return NextResponse.json({ ok: true, skipped: "Los crons sólo corren en producción." });
  const run = await runReportSchedules();
  return NextResponse.json({ ok: run.jobs.every((j) => !j.error || j.to !== "failed"), ...run });
}
