// The WhatsApp version of an alert. Pure.
import type { AlertMessage } from "../notify/types.ts";
import type { OutgoingMessage } from "./client.ts";
import { oneLine } from "./turn-message.ts";

/** Template for alerts (see README, "WhatsApp"). */
export const ALERT_TEMPLATE = "sigma_alerta";

const SEVERITY = { critical: "crítica", high: "alta", medium: "media", low: "baja" } as const;

/** sigma_alerta: {{1}} municipality, {{2}} title, {{3}} summary, {{4}} priority, {{5}} link. */
export function alertNotice(m: AlertMessage): OutgoingMessage {
  const params = [oneLine(m.orgName, 80), oneLine(m.title, 200), oneLine(m.summary, 400), SEVERITY[m.severity], m.url];
  return { kind: "template", template: ALERT_TEMPLATE, params, summary: `Alerta: ${params[1]}` };
}
