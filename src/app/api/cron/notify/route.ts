import { NextResponse, type NextRequest } from "next/server";
import { cronDisabledHere, isAuthorizedCron } from "@/lib/auth/cron";
import { runOutbox } from "@/lib/outbox/server";
import { runReportJobs } from "@/lib/reports/schedule";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

/**
 * Scheduled every 5 minutes in vercel.json: evaluates case deadlines
 * (reminders and escalations, once each), resumes report jobs and sends the
 * outbox (critical first) within a time budget. Safe to run concurrently:
 * steps are unique, messages and jobs are leased.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (cronDisabledHere()) return NextResponse.json({ ok: true, skipped: "Los crons sólo corren en producción." });
  const admin = createAdminClient();
  const { data: escalations, error } = await admin.rpc("enqueue_case_escalations", {});
  if (error) console.error("[notify] escalations:", error.message);
  const reports = await runReportJobs(admin, { limit: 2, budgetMs: 50_000 });
  const outbox = await runOutbox(admin, { budgetMs: 45_000 });
  return NextResponse.json({ ok: !error, escalations: escalations ?? null, reports, outbox });
}
