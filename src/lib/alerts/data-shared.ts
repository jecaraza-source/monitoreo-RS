// Alert event shape shared by the server page and the Realtime feed.
import type { RuleKind, Severity } from "./rules";

export type AlertEvent = {
  id: string;
  ruleId: string;
  ruleName: string;
  kind: RuleKind | null;
  severity: Severity;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  mentionIds: string[];
  departmentId: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  feedback: "useful" | "false_alarm" | null;
  notifications: Record<string, { status: string; detail?: string }>;
};

export const EVENT_SELECT =
  "id, rule_id, kind, severity, title, summary, payload, mention_ids, department_id, created_at, acknowledged_at, feedback, notifications, alert_rules(name)";

export type EventRow = {
  id: string;
  rule_id: string;
  kind: string | null;
  severity: Severity;
  title: string;
  summary: string;
  payload: unknown;
  mention_ids: string[];
  department_id: string | null;
  created_at: string;
  acknowledged_at: string | null;
  feedback: "useful" | "false_alarm" | null;
  notifications: unknown;
  alert_rules: { name: string } | null;
};

export function toAlertEvent(r: EventRow): AlertEvent {
  return {
    id: r.id,
    ruleId: r.rule_id,
    ruleName: r.alert_rules?.name ?? "Regla",
    kind: (r.kind as RuleKind | null) ?? null,
    severity: r.severity,
    title: r.title || "Alerta",
    summary: r.summary,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    mentionIds: r.mention_ids ?? [],
    departmentId: r.department_id,
    createdAt: r.created_at,
    acknowledgedAt: r.acknowledged_at,
    feedback: r.feedback,
    notifications: (r.notifications ?? {}) as AlertEvent["notifications"],
  };
}

