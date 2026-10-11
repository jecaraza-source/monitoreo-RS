// Meta's WhatsApp webhook: signature check and payload parsing. Pure (node
// crypto only) so it is unit-tested without a server.
// https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { normalizePhone } from "./phone.ts";

/** X-Hub-Signature-256 is "sha256=" + HMAC-SHA256(raw body, app secret), hex. */
export function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function signBody(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

/** GET handshake when the webhook is registered in Meta: echo the challenge if the token matches. */
export function verifyChallenge(params: URLSearchParams, verifyToken: string | undefined): string | null {
  if (!verifyToken) return null;
  const token = params.get("hub.verify_token") ?? "";
  const ok =
    params.get("hub.mode") === "subscribe" &&
    token.length === verifyToken.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(verifyToken));
  return ok ? params.get("hub.challenge") : null;
}

// Only the fields used; everything else Meta sends passes through untouched.
const message = z.object({
  id: z.string(),
  from: z.string(),
  timestamp: z.string().optional(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  button: z.object({ payload: z.string().optional(), text: z.string().optional() }).optional(),
  interactive: z
    .object({
      button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
      list_reply: z.object({ id: z.string(), title: z.string() }).optional(),
    })
    .optional(),
  context: z.object({ id: z.string().optional() }).optional(),
});

const status = z.object({
  id: z.string(),
  status: z.string(),
  timestamp: z.string().optional(),
  errors: z.array(z.object({ code: z.number().optional(), title: z.string().optional() })).optional(),
});

const payload = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.object({
            metadata: z.object({ phone_number_id: z.string() }).optional(),
            messages: z.array(message).optional(),
            statuses: z.array(status).optional(),
          }),
        }),
      ),
    }),
  ),
});

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";

export type InboundMessage = {
  waId: string;
  /** Normalized sender number. */
  from: string;
  kind: "text" | "button" | "interactive" | "other";
  /** What the official wrote, or the button's label. */
  text: string;
  /** Quick-reply payload or interactive reply id. */
  payload: string | null;
  /** wamid of the message this one replies to. */
  replyTo: string | null;
  at: Date;
};

export type StatusUpdate = { waId: string; status: DeliveryStatus; error: string | null; at: Date };

export type WebhookEvents = { messages: InboundMessage[]; statuses: StatusUpdate[] };

const STATUSES: readonly string[] = ["sent", "delivered", "read", "failed"];

const at = (timestamp: string | undefined) => (timestamp && /^\d+$/.test(timestamp) ? new Date(Number(timestamp) * 1000) : new Date());

/**
 * Messages and delivery statuses for our number. Changes for any other phone
 * number id (another app on the same business account) are ignored.
 */
export function parseWebhook(body: unknown, phoneNumberId: string | undefined): WebhookEvents | null {
  const parsed = payload.safeParse(body);
  if (!parsed.success || parsed.data.object !== "whatsapp_business_account") return null;
  const events: WebhookEvents = { messages: [], statuses: [] };
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      const value = change.value;
      if (phoneNumberId && value.metadata?.phone_number_id !== phoneNumberId) continue;
      for (const m of value.messages ?? []) {
        const from = normalizePhone(`+${m.from}`);
        if (!from) continue;
        const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
        const kind = m.type === "text" || m.type === "button" || m.type === "interactive" ? m.type : "other";
        events.messages.push({
          waId: m.id,
          from,
          kind,
          text: (m.text?.body ?? m.button?.text ?? reply?.title ?? "").trim(),
          payload: m.button?.payload ?? reply?.id ?? null,
          replyTo: m.context?.id ?? null,
          at: at(m.timestamp),
        });
      }
      for (const s of value.statuses ?? []) {
        if (!STATUSES.includes(s.status)) continue;
        const e = s.errors?.[0];
        events.statuses.push({
          waId: s.id,
          status: s.status as DeliveryStatus,
          error: e ? `${e.code ?? ""} ${e.title ?? ""}`.trim() : null,
          at: at(s.timestamp),
        });
      }
    }
  }
  return events;
}

/** Statuses a message may move from to reach `next`; Meta can deliver them out of order. */
export function previousStatuses(next: DeliveryStatus): DeliveryStatus[] {
  return { sent: [], delivered: ["sent"], read: ["sent", "delivered"], failed: ["sent"] }[next] as DeliveryStatus[];
}
