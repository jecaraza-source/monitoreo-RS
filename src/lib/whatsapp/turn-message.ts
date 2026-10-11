// Texts of the turn notice and of the replies to its buttons. Pure.
import type { OutgoingMessage } from "./client.ts";
import { ticketPayload } from "./conversation.ts";

/** Template that notifies a routed mention (see README, "WhatsApp"). */
export const TURN_TEMPLATE = "sigma_turno";

const PRIORITY = { critical: "Crítica", high: "Alta", medium: "Media", low: "Baja" } as const;
const STATUS = { open: "Abierto", in_progress: "En proceso", resolved: "Resuelto", closed: "Cerrado" } as const;

export type Priority = keyof typeof PRIORITY;
export type TicketStatus = keyof typeof STATUS;

const dateTime = new Intl.DateTimeFormat("es-MX", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Mexico_City",
});

/** Short reference officials can say on the phone: first 6 characters of the ticket id. */
export function folio(ticketId: string): string {
  return ticketId.replace(/-/g, "").slice(0, 6).toUpperCase();
}

/** Template parameters cannot hold line breaks, tabs or long runs of spaces. */
export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export function formatDue(dueAt: string | null): string {
  return dueAt ? dateTime.format(new Date(dueAt)) : "sin fecha límite";
}

export type TurnInfo = {
  ticketId: string;
  department: string;
  text: string;
  priority: Priority;
  dueAt: string | null;
};

/** sigma_turno: {{1}} department, {{2}} folio, {{3}} excerpt, {{4}} priority, {{5}} due date; three quick replies. */
export function turnNotice(t: TurnInfo): OutgoingMessage {
  const params = [oneLine(t.department, 60), folio(t.ticketId), oneLine(t.text, 280), PRIORITY[t.priority], formatDue(t.dueAt)];
  return {
    kind: "template",
    template: TURN_TEMPLATE,
    params,
    buttons: [ticketPayload(t.ticketId, "in_progress"), ticketPayload(t.ticketId, "resolved"), ticketPayload(t.ticketId, "detail")],
    summary: `Turno ${params[1]} · ${params[0]} · ${params[2]}`,
  };
}

export type TurnDetail = TurnInfo & {
  status: TicketStatus;
  mentionId: string;
  source: string | null;
  publishedAt: string;
  neighborhood: string | null;
  url: string | null;
};

export function detailText(d: TurnDetail, appUrl: string): string {
  const text = d.text.length > 900 ? `${d.text.slice(0, 899).trimEnd()}…` : d.text;
  return [
    `Turno ${folio(d.ticketId)} · ${d.department}`,
    `Estado: ${STATUS[d.status]} · Prioridad ${PRIORITY[d.priority].toLowerCase()} · Vence: ${formatDue(d.dueAt)}`,
    d.neighborhood ? `Colonia: ${d.neighborhood}` : null,
    `Publicado: ${dateTime.format(new Date(d.publishedAt))}${d.source ? ` en ${d.source}` : ""}`,
    "",
    `«${text}»`,
    "",
    d.url ? `Publicación: ${d.url}` : null,
    `Ver en Sigma Pulso: ${appUrl}/bandeja?mention=${d.mentionId}`,
    "Responde a este mensaje para agregar una nota.",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export type ActionResult = { ok: true; status: TicketStatus } | { ok: false; reason: string; status?: TicketStatus };

export function actionText(ticketId: string, result: ActionResult, kind: "status" | "note"): string {
  const f = folio(ticketId);
  if (result.ok) {
    return kind === "note" ? `Nota agregada al turno ${f}.` : `Listo: el turno ${f} quedó «${STATUS[result.status]}».`;
  }
  switch (result.reason) {
    case "closed":
      return `El turno ${f} ya fue cerrado por Comunicación; ya no se puede cambiar.`;
    case "forbidden":
      return `El turno ${f} ya no está asignado a tu dependencia.`;
    case "not_found":
      return `No encontramos el turno ${f}; pudo haberse eliminado.`;
    default:
      return "No se pudo registrar tu respuesta. Inténtalo de nuevo o entra a Sigma Pulso.";
  }
}
