// What to do with a message from an official, decided from the contact's
// status and what they wrote. Pure: the webhook applies the result.
import type { InboundMessage } from "./webhook.ts";

export type ContactStatus = "pending" | "active" | "declined" | "opted_out";

/** Quick-reply payloads of the invitation template buttons ("Acepto" / "No acepto"). */
export const INVITE_ACCEPT = "invite:accept";
export const INVITE_DECLINE = "invite:decline";

export type Reply =
  | { kind: "unknown_number" }
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

export function decide(
  contact: { status: ContactStatus; departments: string[] } | null,
  message: Pick<InboundMessage, "text" | "payload">,
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
    case "active":
      // Turn actions arrive in phase 2; meanwhile, point to the app.
      if (accept) return { next: null, reply: { kind: "accepted", departments: contact.departments } };
      return { next: null, reply: { kind: "help", url: appUrl } };
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
      return `Recibido. Para atender tus turnos entra a Sigma Pulso: ${reply.url}/bandeja\nEscribe BAJA para dejar de recibir mensajes.`;
    case "none":
      return null;
  }
}
