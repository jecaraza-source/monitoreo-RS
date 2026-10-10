import { NextResponse, type NextRequest } from "next/server";
import { cronDisabledHere, isAuthorizedCron } from "@/lib/auth/cron";
import { runReportSchedules } from "@/lib/reports/schedule";

// Each scheduled report waits for Claude and renders a PDF.
export const maxDuration = 300;

/** Scheduled in vercel.json (13:00 UTC = 7:00 in Mexico City). */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (cronDisabledHere()) return NextResponse.json({ ok: true, skipped: "Los crons sólo corren en producción." });
  const runs = await runReportSchedules();
  return NextResponse.json({ ok: runs.every((r) => r.status !== "error"), runs });
}
