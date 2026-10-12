// WhatsApp Cloud API: template and free-form text messages. Framework-free
// (env and fetch injected) for unit tests; WHATSAPP_API_URL points to the mock
// in e2e (e2e/mock-anthropic.mjs).
import type { Fetch, NotifyEnv } from "../notify/types.ts";

export const GRAPH_URL = "https://graph.facebook.com/v21.0";

/** Template that asks an official to accept WhatsApp messages (see README, "WhatsApp"). */
export const INVITE_TEMPLATE = "sigma_vinculacion";

export type OutgoingMessage =
  | {
      kind: "template";
      template: string;
      /** Body parameters {{1}}, {{2}}… */
      params: string[];
      /** Quick-reply payloads, by button index. */
      buttons?: string[];
      /** Text kept in the message log (the template with its parameters). */
      summary: string;
    }
  | { kind: "text"; text: string }
  /** Free-form text with up to 3 reply buttons (only within 24 h of the official's last message). */
  | { kind: "buttons"; text: string; buttons: { id: string; title: string }[] };

export type SendResult = { ok: true; waId: string } | { ok: false; error: string; notConfigured?: boolean };

export function whatsappConfigured(env: NotifyEnv): boolean {
  return Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);
}

export function requestBody(to: string, message: OutgoingMessage, lang = "es_MX") {
  if (message.kind === "text") {
    return { messaging_product: "whatsapp", to, type: "text", text: { body: message.text.slice(0, 4096), preview_url: false } };
  }
  if (message.kind === "buttons") {
    return {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: message.text.slice(0, 1024) },
        action: {
          buttons: message.buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) } })),
        },
      },
    };
  }
  const components: Record<string, unknown>[] = [];
  if (message.params.length) {
    components.push({ type: "body", parameters: message.params.map((text) => ({ type: "text", text: text.slice(0, 900) })) });
  }
  (message.buttons ?? []).forEach((payload, index) =>
    components.push({ type: "button", sub_type: "quick_reply", index: String(index), parameters: [{ type: "payload", payload }] }),
  );
  return { messaging_product: "whatsapp", to, type: "template", template: { name: message.template, language: { code: lang }, components } };
}

export async function sendWhatsApp(
  to: string,
  message: OutgoingMessage,
  { env, fetch }: { env: NotifyEnv; fetch: Fetch },
): Promise<SendResult> {
  if (!whatsappConfigured(env)) {
    return { ok: false, notConfigured: true, error: "Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID." };
  }
  const base = (env.WHATSAPP_API_URL ?? GRAPH_URL).replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody(to, message, env.WHATSAPP_TEMPLATE_LANG ?? "es_MX")),
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json().catch(() => null)) as { messages?: { id: string }[]; error?: { message?: string; code?: number } } | null;
    if (!res.ok || !json?.messages?.[0]?.id) {
      return { ok: false, error: `WhatsApp ${res.status}: ${json?.error?.message ?? "sin id de mensaje"}`.slice(0, 300) };
    }
    return { ok: true, waId: json.messages[0].id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
