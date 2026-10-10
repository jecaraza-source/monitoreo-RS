import type { AlertMessage, Notifier } from "./types.ts";

const SEVERITY = { critical: "Crítica", high: "Alta", medium: "Media", low: "Baja" } as const;

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderEmail(m: AlertMessage): { subject: string; html: string; text: string } {
  const subject = `[${SEVERITY[m.severity]}] ${m.title}`;
  const text = `${m.title}\n\n${m.summary}\n\nRegla: ${m.ruleName} · ${m.orgName}\nVer en Sigma Pulso: ${m.url}`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px">
<p style="margin:0 0 4px;color:#64748b;font-size:12px">${escape(m.orgName)} · Prioridad ${SEVERITY[m.severity]}</p>
<h2 style="margin:0 0 12px;font-size:18px;color:#0f172a">${escape(m.title)}</h2>
<p style="margin:0 0 16px;color:#334155;line-height:1.5">${escape(m.summary)}</p>
<p style="margin:0 0 20px"><a href="${escape(m.url)}" style="background:#022b50;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Ver alerta</a></p>
<p style="margin:0;color:#94a3b8;font-size:12px">Regla «${escape(m.ruleName)}». Marca si la alerta fue útil o falsa alarma para afinarla.</p>
</div>`;
  return { subject, html, text };
}

/** Resend REST API (https://resend.com/docs/api-reference/emails/send-email). */
export const emailNotifier: Notifier = {
  channel: "email",
  async send(message, recipients, { env, fetch }) {
    if (recipients.length === 0) return { status: "skipped" };
    const key = env.RESEND_API_KEY;
    const from = env.ALERTS_FROM_EMAIL;
    if (!key || !from) return { status: "not_configured", detail: "Faltan RESEND_API_KEY o ALERTS_FROM_EMAIL." };
    const { subject, html, text } = renderEmail(message);
    try {
      const res = await fetch(`${env.RESEND_BASE_URL ?? "https://api.resend.com"}/emails`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: recipients, subject, html, text }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { status: "failed", detail: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
      return { status: "sent" };
    } catch (error) {
      return { status: "failed", detail: error instanceof Error ? error.message : String(error) };
    }
  },
};
