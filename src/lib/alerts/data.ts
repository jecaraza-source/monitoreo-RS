import "server-only";
import type { Member } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { EVENT_SELECT, toAlertEvent, type AlertEvent, type EventRow } from "./data-shared";
import { parseChannels, type Channels, type RuleKind } from "./rules";

export type { AlertEvent } from "./data-shared";

export type AlertRule = {
  id: string;
  name: string;
  kind: RuleKind;
  condition: Record<string, unknown>;
  channels: Channels;
  departmentId: string | null;
  cooldownMinutes: number;
  isActive: boolean;
  useful: number;
  falseAlarms: number;
  lastFiredAt: string | null;
};

/** Rules and the last 30 days of alerts the member can see (RLS). */
export async function getAlerts(member: Member): Promise<{ rules: AlertRule[]; events: AlertEvent[] }> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [rules, events] = await Promise.all([
    supabase
      .from("alert_rules")
      .select("id, name, kind, condition, channels, department_id, cooldown_minutes, is_active, created_at")
      .eq("org_id", member.orgId)
      .order("created_at"),
    supabase
      .from("alert_events")
      .select(EVENT_SELECT)
      .eq("org_id", member.orgId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  const list = ((events.data ?? []) as unknown as EventRow[]).map(toAlertEvent);
  return {
    events: list,
    rules: (rules.data ?? []).map((r) => {
      const mine = list.filter((e) => e.ruleId === r.id);
      return {
        id: r.id,
        name: r.name,
        kind: r.kind as RuleKind,
        condition: (r.condition ?? {}) as Record<string, unknown>,
        channels: parseChannels(r.channels),
        departmentId: r.department_id,
        cooldownMinutes: r.cooldown_minutes,
        isActive: r.is_active,
        useful: mine.filter((e) => e.feedback === "useful").length,
        falseAlarms: mine.filter((e) => e.feedback === "false_alarm").length,
        lastFiredAt: mine[0]?.createdAt ?? null,
      };
    }),
  };
}
