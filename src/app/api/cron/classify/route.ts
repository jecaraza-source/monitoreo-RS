import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { classifyPending } from "@/lib/ai/classify";

// Batches stop starting at ~45 s; a smart re-pass can add a few seconds.
export const maxDuration = 60;

/** Scheduled every 5 minutes in vercel.json. Manual: curl -H "Authorization: Bearer $CRON_SECRET" …/api/cron/classify */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await classifyPending();
  return NextResponse.json({ ok: !summary.stoppedBy, ...summary }, { status: summary.stoppedBy ? 502 : 200 });
}
