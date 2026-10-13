// What each outbox message says, by kind and channel. Pure: the payload was
// written when the message was queued (by the database or the server) and
// the text is rendered when it is sent.
import { renderEmail as renderAlertEmail } from "../notify/email.ts";
import type { AlertMessage } from "../notify/types.ts";
import { alertNotice } from "../whatsapp/alert-message.ts";
import type { OutgoingMessage } from "../whatsapp/client.ts";
import { oneLine } from "../whatsapp/turn-message.ts";

export type OutboxKind = "reminder" | "escalation" | "emergency" | "alert" | "report";
export type OutboxChannel = "email" | "whatsapp";
export type Email = { subject: string; html: string; text: string };

/** Template for case reminders and escalations (see README, "WhatsApp"). */
export const CASE_TEMPLATE = "sigma_caso_aviso";

export type CasePayload = {
  case_id: string;
  folio: string;
  title: string;
  phase: "acceptance" | "attention";
  level: "link" | "head" | "coordinator";
  deadline: string;
  reason: string;
  emergency: boolean;
  step: "reminder" | "escalation";
};

const KIND_LABEL: Record<"reminder" | "escalation" | "emergency", string> = {
  reminder: "Recordatorio",
  escalation: "Escalamiento",
  emergency: "Emergencia",
};

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function caseEmail(kind: "reminder" | "escalation" | "emergency", p: CasePayload, appUrl: string): Email {
  const label = KIND_LABEL[kind];
  const url = `${appUrl}/casos/${p.case_id}`;
  const subject = `[${label}] ${p.folio} · ${oneLine(p.title, 120)}`;
  const text = `${label}: ${p.reason}\n\n${p.title}\n\nVer el caso: ${url}`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px">
<p style="margin:0 0 4px;color:${kind === "emergency" ? "#b91c1c" : "#64748b"};font-size:12px;font-weight:600">${label} · ${escape(p.folio)}</p>
<h2 style="margin:0 0 12px;font-size:18px;color:#0f172a">${escape(p.title)}</h2>
<p style="margin:0 0 16px;color:#334155;line-height:1.5">${escape(p.reason)}</p>
<p style="margin:0 0 20px"><a href="${escape(url)}" style="background:#022b50;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Ver el caso</a></p>
<p style="margin:0;color:#94a3b8;font-size:12px">Aviso automático por el plazo del caso. Puedes ajustar tus canales y horario en Preferencias.</p>
</div>`;
  return { subject, html, text };
}

/** sigma_caso_aviso: {{1}} kind, {{2}} folio, {{3}} title, {{4}} reason, {{5}} link. */
export function caseWhatsApp(kind: "reminder" | "escalation" | "emergency", p: CasePayload, appUrl: string): OutgoingMessage {
  const params = [KIND_LABEL[kind], p.folio, oneLine(p.title, 200), oneLine(p.reason, 400), `${appUrl}/casos/${p.case_id}`];
  return { kind: "template", template: CASE_TEMPLATE, params, summary: `${params[0]} ${params[1]} · ${params[3]}` };
}

export function alertEmail(p: AlertMessage): Email {
  return renderAlertEmail(p);
}

export function alertWhatsApp(p: AlertMessage): OutgoingMessage {
  return alertNotice(p);
}
