// Cases: states, labels and which actions each role is offered. The database
// (public.case_transition_allowed and friends) is the authority; this mirror
// only decides which buttons to show, and a unit test keeps both in sync.

export const CASE_STATUSES = [
  "new",
  "in_review",
  "assigned",
  "accepted",
  "in_progress",
  "resolved",
  "closed",
  "returned",
  "discarded",
  "merged",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  new: "Detectado",
  in_review: "En revisión",
  assigned: "Asignado",
  accepted: "Aceptado",
  in_progress: "En atención",
  resolved: "Atendido, por validar",
  closed: "Cerrado",
  returned: "Devuelto",
  discarded: "Descartado",
  merged: "Fusionado",
};

export type Tone = "ok" | "info" | "warn" | "error" | "muted";
export const CASE_STATUS_TONE: Record<CaseStatus, Tone> = {
  new: "info",
  in_review: "info",
  assigned: "warn",
  accepted: "warn",
  in_progress: "warn",
  resolved: "info",
  closed: "ok",
  returned: "error",
  discarded: "muted",
  merged: "muted",
};

/** Same table as public.case_transition_allowed. */
export const TRANSITIONS: readonly (readonly [CaseStatus, CaseStatus])[] = [
  ["new", "in_review"], ["new", "assigned"], ["new", "discarded"],
  ["in_review", "assigned"], ["in_review", "discarded"],
  ["assigned", "accepted"], ["assigned", "returned"], ["assigned", "assigned"],
  ["accepted", "in_progress"], ["accepted", "returned"], ["accepted", "assigned"],
  ["in_progress", "resolved"], ["in_progress", "assigned"],
  ["resolved", "closed"], ["resolved", "in_progress"],
  ["returned", "assigned"], ["returned", "in_review"],
  ["closed", "in_review"], ["discarded", "in_review"],
];

/** Same as public.case_transition_by_department. */
const BY_DEPARTMENT: readonly (readonly [CaseStatus, CaseStatus])[] = [
  ["assigned", "accepted"], ["assigned", "returned"],
  ["accepted", "in_progress"], ["accepted", "returned"],
  ["in_progress", "resolved"],
];

export function transitionAllowed(from: CaseStatus, to: CaseStatus): boolean {
  return TRANSITIONS.some(([a, b]) => a === from && b === to);
}

/** Same as public.case_transition_needs_reason. */
export function needsReason(from: CaseStatus, to: CaseStatus): boolean {
  return to === "returned" || to === "discarded" || (from === "resolved" && to === "in_progress") || ((from === "closed" || from === "discarded") && to === "in_review");
}

export type CaseActor = "editor" | "department" | "reader";

export type CaseAction = { to: CaseStatus; label: string; reason: boolean; assign: boolean; primary: boolean };

/** What the person sees as buttons for the case, in a sensible order. */
export function actionsFor(status: CaseStatus, actor: CaseActor, isResponsibleDepartment: boolean): CaseAction[] {
  if (actor === "reader") return [];
  const candidates = TRANSITIONS.filter(([from]) => from === status).map(([, to]) => to);
  return candidates
    .filter((to) => actor === "editor" || (isResponsibleDepartment && BY_DEPARTMENT.some(([a, b]) => a === status && b === to)))
    .map((to) => ({
      to,
      label: actionLabel(status, to),
      reason: needsReason(status, to),
      assign: to === "assigned",
      primary: PRIMARY[status] === to,
    }));
}

const PRIMARY: Partial<Record<CaseStatus, CaseStatus>> = {
  new: "in_review",
  in_review: "assigned",
  assigned: "accepted",
  accepted: "in_progress",
  in_progress: "resolved",
  resolved: "closed",
  returned: "assigned",
};

function actionLabel(from: CaseStatus, to: CaseStatus): string {
  if (to === "assigned") return from === "new" || from === "in_review" ? "Asignar" : "Reasignar";
  if (to === "in_review") return from === "closed" || from === "discarded" ? "Reabrir" : from === "returned" ? "Volver a revisión" : "Revisar";
  if (from === "resolved" && to === "in_progress") return "Rechazar validación";
  return {
    accepted: "Aceptar",
    in_progress: "Iniciar atención",
    resolved: "Marcar atendido",
    closed: "Validar y cerrar",
    returned: "Devolver por competencia",
    discarded: "Descartar",
  }[to as string] ?? CASE_STATUS_LABELS[to];
}

/** States where work is still pending (filters, counters). */
export const OPEN_CASE_STATUSES: readonly CaseStatus[] = ["new", "in_review", "assigned", "accepted", "in_progress", "resolved", "returned"];

export const EVENT_LABELS: Record<string, string> = {
  created: "Abrió el caso",
  status: "Cambió el estado",
  reopened: "Reabrió el caso",
  updated: "Editó el caso",
  mentions_added: "Agregó menciones",
  mention_removed: "Quitó una mención",
  merged_into: "Fusionó este caso en otro",
  merged_from: "Fusionó otro caso en éste",
  note: "Agregó una nota",
  backfill: "Creado desde turnos existentes",
};

export const FIELD_LABELS: Record<string, string> = {
  title: "Título",
  description: "Descripción",
  category: "Categoría",
  neighborhood_id: "Colonia",
  priority: "Prioridad",
  due_at: "Plazo",
  responsible_user_id: "Responsable",
  department_id: "Dependencia",
};

/** Past its due date while someone still has to act (resolved waits for validation, not for the department). */
export function caseOverdue(status: CaseStatus, dueAt: string | null, now = Date.now()): boolean {
  return Boolean(dueAt) && OPEN_CASE_STATUSES.includes(status) && status !== "resolved" && new Date(dueAt!).getTime() < now;
}
