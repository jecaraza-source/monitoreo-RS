import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleWebhook } from "@/lib/whatsapp/service";
import { parseWebhook, verifyChallenge, verifySignature } from "@/lib/whatsapp/webhook";

/**
 * Meta's WhatsApp webhook. GET: the one-time handshake when the URL is
 * registered (WHATSAPP_VERIFY_TOKEN). POST: messages from officials and
 * delivery statuses, accepted only when signed with the app secret.
 */
export async function GET(request: NextRequest) {
  const challenge = verifyChallenge(request.nextUrl.searchParams, process.env.WHATSAPP_VERIFY_TOKEN);
  return challenge === null
    ? NextResponse.json({ error: "forbidden" }, { status: 403 })
    : new NextResponse(challenge, { headers: { "content-type": "text/plain" } });
}

export async function POST(request: NextRequest) {
  const secret = process.env.WHATSAPP_APP_SECRET ?? process.env.META_APP_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const events = parseWebhook(body, process.env.WHATSAPP_PHONE_NUMBER_ID);
  // Anything else Meta may send (other fields, test pings) is acknowledged and ignored.
  if (!events) return NextResponse.json({ ok: true, ignored: true });
  try {
    await handleWebhook(createAdminClient(), events);
  } catch (error) {
    // A 5xx makes Meta retry; processed messages are skipped by their wamid.
    console.error("[whatsapp] webhook:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "retry" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, messages: events.messages.length, statuses: events.statuses.length });
}
