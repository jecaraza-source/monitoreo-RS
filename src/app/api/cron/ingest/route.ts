import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { runIngest } from "@/lib/ingest/run";

// The worker stops starting new sources at ~45 s to fit in this budget.
export const maxDuration = 60;

/** Scheduled in vercel.json. Manual run: curl -H "Authorization: Bearer $CRON_SECRET" …/api/cron/ingest */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await runIngest({ trigger: "cron" });
  const failed = summary.sources.filter((s) => s.status === "error").length;
  return NextResponse.json({ ok: failed === 0, ...summary });
}
