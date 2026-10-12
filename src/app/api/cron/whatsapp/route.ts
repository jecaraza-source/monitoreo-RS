import { NextResponse, type NextRequest } from "next/server";
import { cronDisabledHere, isAuthorizedCron } from "@/lib/auth/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendFollowUps } from "@/lib/whatsapp/turns";

export const maxDuration = 300;

/**
 * Scheduled every 15 minutes in vercel.json: WhatsApp reminders at 75% of a
 * turn's deadline and escalation when it expires (not at night).
 * Manual: curl -H "Authorization: Bearer $CRON_SECRET" …/api/cron/whatsapp
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (cronDisabledHere()) return NextResponse.json({ ok: true, skipped: "Los crons sólo corren en producción." });
  try {
    return NextResponse.json({ ok: true, ...(await sendFollowUps(createAdminClient())) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
