import { NextResponse, type NextRequest } from "next/server";
import { cronDisabledHere, isAuthorizedCron } from "@/lib/auth/cron";
import { refreshMentionStats } from "@/lib/dashboard/refresh";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

const BATCH = 5000;
const TIME_BUDGET_MS = 240_000;

/**
 * Daily purge of mentions older than RETENTION_MONTHS (default 24) with their
 * classifications, tickets and notes. Each batch is recorded in audit_log.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (cronDisabledHere()) return NextResponse.json({ ok: true, skipped: "Los crons sólo corren en producción." });

  const months = Number(process.env.RETENTION_MONTHS ?? 24);
  if (!Number.isInteger(months) || months < 1) {
    return NextResponse.json({ ok: false, error: "RETENTION_MONTHS debe ser un entero de 1 o más." }, { status: 500 });
  }
  const admin = createAdminClient();
  const started = Date.now();
  let deleted = 0;
  for (;;) {
    const { data, error } = await admin.rpc("purge_old_mentions", { p_months: months, p_batch: BATCH });
    if (error) return NextResponse.json({ ok: false, deleted, error: error.message }, { status: 500 });
    deleted += data ?? 0;
    if ((data ?? 0) < BATCH || Date.now() - started > TIME_BUDGET_MS) break;
  }
  if (deleted > 0) await refreshMentionStats(admin);
  return NextResponse.json({ ok: true, months, deleted });
}
