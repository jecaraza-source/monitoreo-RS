// What to do with a message from an official, decided from the contact's
// status and what they wrote. Pure: the webhook applies the result.
import type { InboundMessage } from "./webhook.ts";

export type ContactStatus = "pending" | "active" | "declined" | "opted_out";

/** Quick-reply payloads of the invitation template buttons ("Acepto" / "No acepto"). */
export const INVITE_ACCEPT = "invite:accept";
export const INVITE_DECLINE = "invite:decline";

/** Buttons of the turn notice (sigma_turno): "ticket:<id>:<action>". */
export type TicketAction = "in_progress" | "resolved" | "detail";
export const TICKET_ACTIONS: readonly TicketAction[] = ["in_progress", "resolved", "detail"];

export function ticketPayload(ticketId: string, action: TicketAction): string {
  return `ticket:${ticketId}:${action}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseTicketPayload(payload: string | null): { ticketId: string; action: TicketAction } | null {
  const [kind, ticketId, action] = (payload ?? "").split(":");
  if (kind !== "ticket" || !UUID.test(ticketId ?? "") || !TICKET_ACTIONS.includes(action as TicketAction)) return null;
  return { ticketId, action: action as TicketAction };
}

export type Reply =
  | { kind: "unknown_number" }
  | { kind: "ticket_action"; ticketId: string; action: TicketAction }
  /** A reply to one of our messages: becomes a note on that message's ticket, if it has one. */
  | { kind: "note"; replyTo: string; text: string }
  /** PENDIENTES: the official's open turns. */
  | { kind: "pending_list" }
  /** A folio (A1B2C3): that turn's detail with its buttons. */
  | { kind: "ticket_lookup"; folio: string }
  | { kind: "accepted"; departments: string[] }
  | { kind: "declined" }
  | { kind: "opted_out" }
  | { kind: "opted_in"; departments: string[] }
  | { kind: "pending_help" }
  | { kind: "help"; url: string }
  | { kind: "none" };

export type Decision = { next: ContactStatus | null; reply: Reply };

/** Lowercase, no accents or punctuation: "¡Acepto!" → "acepto". */
export function keyword(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

const ACCEPT = new Set(["acepto", "si", "si acepto", "aceptar"]);
const DECLINE = new Set(["no acepto", "no"]);
const STOP = new Set(["baja", "stop", "alto", "cancelar"]);
const START = new Set(["alta", "start"]);
const PENDING = new Set(["pendientes", "pendiente", "mis turnos", "turnos"]);
/** The short reference of a turn (see folio() in turn-message.ts), optionally after "folio". */
const FOLIO = /^(?:folio )?([0-9a-f]{6})$/;

export function decide(
  contact: { status: ContactStatus; departments: string[] } | null,
  message: Pick<InboundMessage, "text" | "payload"> & { replyTo?: string | null },
  appUrl: string,
): Decision {
  if (!contact) return { next: null, reply: { kind: "unknown_number" } };
  const word = keyword(message.text);
  const accept = message.payload === INVITE_ACCEPT || ACCEPT.has(word);
  const decline = message.payload === INVITE_DECLINE || DECLINE.has(word);

  // BAJA works from any state and always wins.
  if (STOP.has(word)) {
    return contact.status === "opted_out" || contact.status === "declined"
      ? { next: null, reply: { kind: "none" } }
      : { next: "opted_out", reply: { kind: "opted_out" } };
  }
  switch (contact.status) {
    case "pending":
    case "declined":
      if (accept) return { next: "active", reply: { kind: "accepted", departments: contact.departments } };
      if (decline) return contact.status === "pending" ? { next: "declined", reply: { kind: "declined" } } : { next: null, reply: { kind: "none" } };
      return contact.status === "pending" ? { next: null, reply: { kind: "pending_help" } } : { next: null, reply: { kind: "none" } };
    case "opted_out":
      if (START.has(word) || accept) return { next: "active", reply: { kind: "opted_in", departments: contact.departments } };
      return { next: null, reply: { kind: "none" } };
    case "active": {
      const ticket = parseTicketPayload(message.payload);
      if (ticket) return { next: null, reply: { kind: "ticket_action", ...ticket } };
      if (!message.payload && PENDING.has(word)) return { next: null, reply: { kind: "pending_list" } };
      const folio = message.payload ? null : FOLIO.exec(word);
      if (folio) return { next: null, reply: { kind: "ticket_lookup", folio: folio[1].toUpperCase() } };
      if (accept) return { next: null, reply: { kind: "accepted", departments: contact.departments } };
      if (message.replyTo && message.text && !message.payload) {
        return { next: null, reply: { kind: "note", replyTo: message.replyTo, text: message.text } };
      }
      return { next: null, reply: { kind: "help", url: appUrl } };
    }
  }
}

const list = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "tu área") : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;

/** Free-form text for a reply (allowed: the official wrote in the last 24 h). Null: send nothing. */
export function replyText(reply: Reply): string | null {
  switch (reply.kind) {
    case "unknown_number":
      return "Este número de Sigma Pulso es exclusivo para funcionarios registrados y no recibe reportes ciudadanos. Para un reporte, usa los canales oficiales de tu municipio.";
    case "accepted":
      return `¡Listo! Quedaste como responsable de ${list(reply.departments)} en Sigma Pulso. Por aquí te llegarán las menciones ciudadanas turnadas a tu área. Escribe BAJA para dejar de recibir mensajes.`;
    case "declined":
      return "Entendido, no te enviaremos mensajes. Si cambias de opinión, responde ACEPTO.";
    case "opted_out":
      return "Listo, ya no recibirás mensajes de Sigma Pulso. Escribe ALTA para volver a recibirlos.";
    case "opted_in":
      return `Bienvenido de nuevo. Volverás a recibir los turnos de ${list(reply.departments)}.`;
    case "pending_help":
      return "Para recibir los turnos de tu área por WhatsApp, responde ACEPTO. Si no quieres recibirlos, responde NO ACEPTO.";
    case "help":
      return `Escribe PENDIENTES para ver tus turnos abiertos, o el folio de uno (por ejemplo A1B2C3) para ver su detalle. Usa los botones de cada turno para marcarlo En proceso o Resuelto, o responde a su mensaje para agregar una nota. Tus turnos: ${reply.url}/bandeja\nEscribe BAJA para dejar de recibir mensajes.`;
    case "ticket_action":
    case "note":
    case "pending_list":
    case "ticket_lookup":
    case "none":
      return null;
  }
}
