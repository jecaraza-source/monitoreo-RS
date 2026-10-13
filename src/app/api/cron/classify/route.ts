import { NextResponse, type NextRequest } from "next/server";
import { cronDisabledHere, isAuthorizedCron } from "@/lib/auth/cron";
import { classifyPending, type ClassifySummary } from "@/lib/ai/classify";
import { evaluateAlerts } from "@/lib/alerts/evaluate";
import { processStatsInvalidations } from "@/lib/dashboard/refresh";
import { createAdminClient } from "@/lib/supabase/admin";

// Batches stop starting at ~45 s; a smart re-pass and the alert rules add a few seconds.
export const maxDuration = 60;

/**
 * Scheduled every 5 minutes in vercel.json: classifies pending mentions, then
 * evaluates the alert rules (also when classification could not run, so the
 * daily digest and volume spikes still fire) and applies pending corrections
 * to the aggregates (stats_invalidations), so a correction reaches the
 * dashboard within the freshness SLA even if its immediate refresh failed.
 * Manual: curl -H "Authorization: Bearer $CRON_SECRET" …/api/cron/classify
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (cronDisabledHere()) return NextResponse.json({ ok: true, skipped: "Los crons sólo corren en producción." });
  let summary: ClassifySummary;
  try {
    summary = await classifyPending();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    summary = { batches: 0, classified: 0, failed: 0, escalated: 0, costUsd: 0, stoppedBy: message };
  }
  const admin = createAdminClient();
  const alerts = await evaluateAlerts(admin);
  const invalidations = await processStatsInvalidations(admin);
  return NextResponse.json(
    { ok: !summary.stoppedBy, ...summary, alerts, invalidations },
    { status: summary.stoppedBy ? 502 : 200 },
  );
}
