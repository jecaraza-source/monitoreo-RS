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
  resolved: "Pendiente de validación",
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

export type TransitionActor = "department" | "validation" | "coordination";

/** Same as public.case_transition_actor: who performs each step. */
export function transitionActor(from: CaseStatus, to: CaseStatus): TransitionActor | null {
  if (!transitionAllowed(from, to)) return null;
  if (BY_DEPARTMENT.some(([a, b]) => a === from && b === to)) return "department";
  if (from === "resolved" && (to === "closed" || to === "in_progress")) return "validation";
  return "coordination";
}

/** editor: admin and comunicación (coordination). */
export type CaseActor = "editor" | "department" | "reader";

export type CaseAction = {
  to: CaseStatus;
  label: string;
  reason: boolean;
  assign: boolean;
  primary: boolean;
  /** Validation dialog: close with a result or return with a reason. */
  validate: boolean;
  /** Reopen dialog: reason and evidence that the problem persists. */
  reopen: boolean;
  /** A department step registered by coordination on its behalf (needs a reason). */
  onBehalf: boolean;
};

/** What the person sees as buttons for the case, in a sensible order. */
export function actionsFor(status: CaseStatus, actor: CaseActor, isResponsibleDepartment: boolean): CaseAction[] {
  if (actor === "reader") return [];
  const out: CaseAction[] = [];
  for (const [from, to] of TRANSITIONS) {
    if (from !== status) continue;
    const who = transitionActor(from, to)!;
    if (actor === "department" && !(who === "department" && isResponsibleDepartment)) continue;
    // Validation is one dialog (close or return), offered once.
    if (who === "validation") {
      if (to === "closed") out.push(action(status, to, { validate: true, label: "Validar" }));
      continue;
    }
    const onBehalf = actor === "editor" && who === "department";
    const reopen = actor === "editor" && status === "closed" && to === "in_review";
    out.push(
      action(status, to, {
        onBehalf,
        reopen,
        reason: needsReason(status, to) || onBehalf,
        label: onBehalf ? `${actionLabel(status, to)} (en nombre de la dependencia)` : undefined,
      }),
    );
  }
  // The department's own path first; steps on its behalf after coordination's.
  return out.sort((a, b) => Number(a.onBehalf) - Number(b.onBehalf));
}

function action(from: CaseStatus, to: CaseStatus, o: Partial<CaseAction>): CaseAction {
  return {
    to,
    label: o.label ?? actionLabel(from, to),
    reason: o.reason ?? needsReason(from, to),
    assign: to === "assigned",
    primary: !o.onBehalf && PRIMARY[from] === to,
    validate: o.validate ?? false,
    reopen: o.reopen ?? false,
    onBehalf: o.onBehalf ?? false,
  };
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
  return {
    accepted: "Aceptar",
    in_progress: "Iniciar atención",
    resolved: "Solicitar validación",
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
  assignment_terms: "Definió responsable y plazos",
  update: "Reportó un avance",
  reopen_evidence: "Agregó evidencia de que el problema persiste",
  task_added: "Agregó una tarea",
  task_status: "Actualizó una tarea",
  location_confirmed: "Confirmó la ubicación",
  location_corrected: "Corrigió la ubicación",
  location_cleared: "Quitó la ubicación",
  sla_reapplied: "Reaplicó el SLA vigente (cambió el plazo)",
};

export const FIELD_LABELS: Record<string, string> = {
  title: "Título",
  description: "Descripción",
  category: "Categoría",
  neighborhood_id: "Colonia",
  priority: "Prioridad",
  due_at: "Compromiso de atención",
  accept_due_at: "Plazo de aceptación",
  commitment: "Compromiso",
  responsible_user_id: "Responsable",
  department_id: "Dependencia",
};

/**
 * The deadline that matters now: an assigned case must be accepted first
 * (acceptance deadline), then attended (commitment). None while it waits for
 * validation or is not with a department.
 */
export function caseDueAt(c: { status: CaseStatus; due_at: string | null; accept_due_at?: string | null }): string | null {
  if (c.status === "assigned") {
    const dates = [c.accept_due_at, c.due_at].filter((d): d is string => Boolean(d));
    return dates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ?? null;
  }
  return c.status === "accepted" || c.status === "in_progress" ? c.due_at : null;
}

/** Past the deadline that matters now (see caseDueAt). */
export function caseOverdue(c: { status: CaseStatus; due_at: string | null; accept_due_at?: string | null }, now = Date.now()): boolean {
  const due = caseDueAt(c);
  return Boolean(due) && new Date(due!).getTime() < now;
}

export type TaskStatus = "pending" | "in_progress" | "done" | "cancelled";
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Pendiente",
  in_progress: "En proceso",
  done: "Hecha",
  cancelled: "Cancelada",
};

/** Same as public.update_case_task: next steps of a task; manager = lead area or coordination. */
export function taskActions(status: TaskStatus, manager: boolean): { to: TaskStatus; label: string; note: boolean }[] {
  const steps: { to: TaskStatus; label: string; note: boolean }[] = [];
  if (status === "pending") steps.push({ to: "in_progress", label: "Iniciar", note: false });
  if (status === "pending" || status === "in_progress") steps.push({ to: "done", label: "Marcar hecha", note: false });
  if (manager && (status === "pending" || status === "in_progress")) steps.push({ to: "cancelled", label: "Cancelar", note: true });
  if (manager && status === "done") steps.push({ to: "in_progress", label: "Reabrir tarea", note: true });
  return steps;
}

/** An open task past its due date. */
export function taskOverdue(t: { status: TaskStatus; due_at: string | null }, now = Date.now()): boolean {
  return Boolean(t.due_at) && (t.status === "pending" || t.status === "in_progress") && new Date(t.due_at!).getTime() < now;
}

/** Elapsed time in words: "45 min", "3 h 20 min", "2 d 4 h". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}
