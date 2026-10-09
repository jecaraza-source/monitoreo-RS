import type { Notifier } from "./types.ts";

/**
 * WhatsApp Business Cloud API. Messages a government account starts must use
 * a template approved by Meta; this sends WHATSAPP_TEMPLATE (language
 * WHATSAPP_TEMPLATE_LANG, es_MX by default) with two body parameters: the
 * alert title and the link. Inactive until the variables are set.
 */
export const whatsappNotifier: Notifier = {
  channel: "whatsapp",
  async send(message, recipients, { env, fetch }) {
    if (recipients.length === 0) return { status: "skipped" };
    const token = env.WHATSAPP_TOKEN;
    const phoneId = env.WHATSAPP_PHONE_NUMBER_ID;
    const template = env.WHATSAPP_TEMPLATE;
    if (!token || !phoneId || !template) {
      return { status: "not_configured", detail: "Faltan WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID o WHATSAPP_TEMPLATE." };
    }
    const failures: string[] = [];
    for (const to of recipients) {
      try {
        const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: to.replace(/^\+/, ""),
            type: "template",
            template: {
              name: template,
              language: { code: env.WHATSAPP_TEMPLATE_LANG ?? "es_MX" },
              components: [
                { type: "body", parameters: [{ type: "text", text: message.title.slice(0, 900) }, { type: "text", text: message.url }] },
              ],
            },
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) failures.push(`${to}: ${res.status}`);
      } catch (error) {
        failures.push(`${to}: ${error instanceof Error ? error.message : error}`);
      }
    }
    return failures.length ? { status: "failed", detail: failures.join("; ").slice(0, 300) } : { status: "sent" };
  },
};
