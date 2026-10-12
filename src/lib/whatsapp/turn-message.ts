// Texts of the turn notice and of the replies to its buttons. Pure.
import type { OutgoingMessage } from "./client.ts";
import { ticketPayload } from "./conversation.ts";

/** Templates (see README, "WhatsApp"): routed mention, reminder / expired, escalation. */
export const TURN_TEMPLATE = "sigma_turno";
export const REMINDER_TEMPLATE = "sigma_recordatorio";
export const ESCALATION_TEMPLATE = "sigma_escalamiento";

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

const hourInMexico = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Mexico_City" });

/**
 * Reminders and escalations wait out the night: WHATSAPP_QUIET_HOURS as
 * "from-to" in Mexico City hours (default "22-7"); "off" sends at any time.
 */
export function isQuietHour(now: Date, spec = "22-7"): boolean {
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(spec.trim());
  if (!match) return false;
  const [from, to] = [Number(match[1]), Number(match[2])];
  const hour = Number(hourInMexico.format(now));
  return from > to ? hour >= from || hour < to : hour >= from && hour < to;
}

export function formatDue(dueAt: string | null): string {
  return dueAt ? dateTime.format(new Date(dueAt)) : "sin fecha límite";
}

const turnButtons = (ticketId: string) => [
  ticketPayload(ticketId, "in_progress"),
  ticketPayload(ticketId, "resolved"),
  ticketPayload(ticketId, "detail"),
];

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
    buttons: turnButtons(t.ticketId),
    summary: `Turno ${params[1]} · ${params[0]} · ${params[2]}`,
  };
}

export type FollowUpInfo = TurnInfo & { status: TicketStatus };

/**
 * sigma_recordatorio, to the department's responsible: {{1}} folio, {{2}}
 * department, {{3}} its situation ("sigue abierto y ya venció"), {{4}} due
 * date, {{5}} excerpt; the same three quick replies as the turn notice.
 */
export function reminderNotice(t: FollowUpInfo, overdue: boolean): OutgoingMessage {
  const params = [
    folio(t.ticketId),
    oneLine(t.department, 60),
    `sigue ${STATUS[t.status].toLowerCase()} y ${overdue ? "ya venció" : "está por vencer"}`,
    formatDue(t.dueAt),
    oneLine(t.text, 280),
  ];
  return {
    kind: "template",
    template: REMINDER_TEMPLATE,
    params,
    buttons: turnButtons(t.ticketId),
    summary: `${overdue ? "Turno vencido" : "Recordatorio"} ${params[0]} · ${params[1]} · ${params[4]}`,
  };
}

/** sigma_escalamiento, to the escalation contact: {{1}} department, {{2}} folio, {{3}} priority, {{4}} due date, {{5}} excerpt; "Ver detalle". */
export function escalationNotice(t: FollowUpInfo): OutgoingMessage {
  const params = [oneLine(t.department, 60), folio(t.ticketId), PRIORITY[t.priority].toLowerCase(), formatDue(t.dueAt), oneLine(t.text, 280)];
  return {
    kind: "template",
    template: ESCALATION_TEMPLATE,
    params,
    buttons: [ticketPayload(t.ticketId, "detail")],
    summary: `Escalamiento ${params[1]} · ${params[0]} · ${params[4]}`,
  };
}

/** Reply to PENDIENTES: the official's open turns, most urgent first. */
export function pendingText(turns: FollowUpInfo[], total: number, appUrl: string, now: Date): string {
  if (!turns.length) return `No tienes turnos pendientes.\nTodos tus turnos: ${appUrl}/bandeja`;
  const lines = turns.map((t, i) => {
    const late = t.dueAt && new Date(t.dueAt) <= now ? " ⚠️ vencido" : "";
    return [
      `${i + 1}. ${folio(t.ticketId)} · ${t.department} · ${PRIORITY[t.priority]} · ${STATUS[t.status]}`,
      `   Vence: ${formatDue(t.dueAt)}${late}`,
      `   «${oneLine(t.text, 90)}»`,
    ].join("\n");
  });
  const head = total === 1 ? "Tienes 1 turno pendiente:" : `Tienes ${total} turnos pendientes${total > turns.length ? ` (los ${turns.length} más urgentes)` : ""}:`;
  return [head, "", lines.join("\n\n"), "", "Escribe el folio de uno para ver su detalle y actualizarlo.", `Todos tus turnos: ${appUrl}/bandeja`].join("\n");
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

/** The detail of a turn with its status buttons (a free-form reply, so within the 24 h window). */
export function detailMessage(d: TurnDetail, appUrl: string): OutgoingMessage {
  const text = detailText({ ...d, text: d.text.length > 500 ? `${d.text.slice(0, 499).trimEnd()}…` : d.text }, appUrl);
  if (d.status === "resolved" || d.status === "closed") return { kind: "text", text };
  return {
    kind: "buttons",
    text,
    buttons: [
      { id: ticketPayload(d.ticketId, "in_progress"), title: "En proceso" },
      { id: ticketPayload(d.ticketId, "resolved"), title: "Resuelto" },
    ],
  };
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
