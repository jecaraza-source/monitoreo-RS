// Delivery providers for the outbox. Framework-free (env and fetch injected).
// Email goes through Resend with the outbox key as Idempotency-Key: if a send
// was accepted but the worker died before recording it, the retry returns
// the same message instead of sending a second one.
import type { Fetch, NotifyEnv } from "../notify/types.ts";
import { sendWhatsApp, type OutgoingMessage } from "../whatsapp/client.ts";
import type { Email } from "./render.ts";

export type SendOutcome = { ok: true; providerId: string } | { ok: false; error: string; retryable: boolean };

export type Attachment = { filename: string; content: string };

export async function sendEmail(
  to: string,
  email: Email & { attachments?: Attachment[]; from?: string },
  idempotencyKey: string,
  { env, fetch }: { env: NotifyEnv; fetch: Fetch },
): Promise<SendOutcome> {
  const key = env.RESEND_API_KEY;
  const from = email.from ?? env.ALERTS_FROM_EMAIL;
  if (!key || !from) return { ok: false, error: "Faltan RESEND_API_KEY o el remitente.", retryable: false };
  try {
    const res = await fetch(`${env.RESEND_BASE_URL ?? "https://api.resend.com"}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ from, to: [to], subject: email.subject, html: email.html, text: email.text, attachments: email.attachments }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (res.ok && body?.id) return { ok: true, providerId: body.id };
    // 4xx other than 409/429 will not get better by retrying (bad address, bad request).
    const retryable = res.status >= 500 || res.status === 429 || res.status === 409;
    return { ok: false, error: `Resend ${res.status}: ${(body?.message ?? "sin id").slice(0, 200)}`, retryable };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), retryable: true };
  }
}

export async function sendWhatsAppMessage(to: string, message: OutgoingMessage, deps: { env: NotifyEnv; fetch: Fetch }): Promise<SendOutcome> {
  const result = await sendWhatsApp(to, message, deps);
  if (result.ok) return { ok: true, providerId: result.waId };
  return { ok: false, error: result.error, retryable: !result.notConfigured && !/WhatsApp 4\d\d/.test(result.error) };
}
