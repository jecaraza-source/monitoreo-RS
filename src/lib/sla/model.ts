// SLA settings: shapes and labels shared by the forms and the server. Pure.
import { PRIORITIES, type Priority } from "../inbox/model.ts";

export const WEEKDAYS = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mié" },
  { value: 4, label: "Jue" },
  { value: 5, label: "Vie" },
  { value: 6, label: "Sáb" },
  { value: 7, label: "Dom" },
] as const;

export type SlaMode = "calendar" | "business";
export const SLA_MODE_LABELS: Record<SlaMode, string> = { calendar: "Horas corridas", business: "Horas hábiles" };

export type SlaTarget = { category: string | null; priority: Priority; accept_hours: number; attention_hours: number };
export type SlaCalendar = { mode: SlaMode; workdays: number[]; day_start: string; day_end: string };
export type SlaHoliday = { day: string; name: string };

/** Problems a person can fix before saving, in Spanish (the database checks again). */
export function slaProblem(calendar: SlaCalendar, targets: SlaTarget[]): string | null {
  if (!calendar.workdays.length) return "Elige al menos un día hábil.";
  if (calendar.day_end <= calendar.day_start) return "La hora de cierre debe ser después de la de apertura.";
  for (const p of PRIORITIES) if (!targets.some((t) => t.category === null && t.priority === p)) return "Define los plazos generales de las cuatro prioridades.";
  for (const t of targets) {
    if (!(t.accept_hours > 0) || !(t.attention_hours > 0)) return "Los plazos deben ser mayores que cero.";
    if (t.accept_hours > t.attention_hours) return "La aceptación no puede tardar más que la atención.";
    if (t.attention_hours > 2160 || t.accept_hours > 720) return "Plazo demasiado largo (máximo 90 días de atención y 30 de aceptación).";
  }
  const general = (p: Priority) => targets.find((t) => t.category === null && t.priority === p)!.attention_hours;
  if (!(general("critical") <= general("high") && general("high") <= general("medium") && general("medium") <= general("low"))) {
    return "Una prioridad mayor debe tener un plazo igual o menor.";
  }
  const keys = targets.map((t) => `${t.category ?? ""}|${t.priority}`);
  if (new Set(keys).size !== keys.length) return "Hay plazos repetidos para la misma categoría y prioridad.";
  return null;
}

export const OUTBOX_STATUS_LABELS: Record<string, string> = {
  pending: "En cola",
  sending: "Enviando",
  sent: "Enviado",
  dead: "Falló",
  uncertain: "Incierto",
  cancelled: "Cancelado",
};

export const OUTBOX_KIND_LABELS: Record<string, string> = {
  reminder: "Recordatorio",
  escalation: "Escalamiento",
  emergency: "Emergencia",
  alert: "Alerta",
  report: "Reporte",
};

export const DEFERRED_LABELS: Record<string, string> = {
  quiet_hours: "horario de silencio",
  hourly_limit: "límite por hora",
  channel_off: "canal desactivado por la persona",
};

export const JOB_STAGE_LABELS: Record<string, string> = {
  queued: "En cola",
  drafted: "Borrador generado",
  approved: "Aprobado",
  rendered: "PDF guardado",
  sending: "Enviando",
  done: "Enviado",
  awaiting_approval: "Espera aprobación",
  failed: "Falló",
};

/** "obras@…" → "o***@monitoreo.test"; "5215550000001" → "52155****001". Addresses of officials, shown to admins only. */
export function maskAddress(address: string): string {
  const at = address.indexOf("@");
  if (at > 0) return `${address[0]}***${address.slice(at)}`;
  return address.length > 7 ? `${address.slice(0, 5)}****${address.slice(-3)}` : "****";
}
