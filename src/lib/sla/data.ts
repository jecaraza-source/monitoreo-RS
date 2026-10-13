import "server-only";
import type { Member } from "@/lib/auth/session";
import type { Priority } from "@/lib/inbox/model";
import { createClient } from "@/lib/supabase/server";
import type { SlaCalendar, SlaHoliday, SlaMode, SlaTarget } from "./model";

export type SlaVersion = { id: string; version: number; created_at: string; approved: boolean; approved_at: string | null; approval_note: string | null };
export type NotificationSettings = {
  reminder_percent: number;
  link_after_hours: number;
  head_after_hours: number;
  coordinator_after_hours: number;
  quiet_start: number;
  quiet_end: number;
  max_per_hour: number;
  whatsapp_enabled: boolean;
};
export type Person = { user_id: string; name: string; department_id: string | null };

export async function getSlaSettings(member: Member) {
  const supabase = await createClient();
  const [calendar, holidays, targets, versions, settings, departments, deptPeople, coordinators] = await Promise.all([
    supabase.from("sla_calendars").select("mode, workdays, day_start, day_end").eq("org_id", member.orgId).maybeSingle(),
    supabase.from("sla_holidays").select("day, name").eq("org_id", member.orgId).order("day"),
    supabase.from("sla_targets").select("category, priority, accept_hours, attention_hours").eq("org_id", member.orgId),
    supabase.from("sla_versions").select("id, version, created_at, approved, approved_at, approval_note").eq("org_id", member.orgId).order("version", { ascending: false }).limit(10),
    supabase.from("notification_settings").select("*").eq("org_id", member.orgId).maybeSingle(),
    supabase.from("departments").select("id, name, responsible_user_id, head_user_id").eq("org_id", member.orgId).order("name"),
    supabase.rpc("department_people", { p_org_id: member.orgId }),
    supabase.rpc("whatsapp_recipients", { p_org_id: member.orgId }),
  ]);
  const cal = calendar.data;
  const people: Person[] = [
    ...(deptPeople.data ?? []).map((p) => ({ user_id: p.user_id, name: p.name, department_id: p.department_id })),
    // Admin and comunicación may also be a department's link or head.
    ...(coordinators.data ?? []).map((p) => ({ user_id: p.user_id, name: p.email, department_id: null })),
  ];
  return {
    calendar: {
      mode: (cal?.mode ?? "calendar") as SlaMode,
      workdays: cal?.workdays ?? [1, 2, 3, 4, 5],
      day_start: (cal?.day_start ?? "09:00").slice(0, 5),
      day_end: (cal?.day_end ?? "17:00").slice(0, 5),
    } satisfies SlaCalendar,
    holidays: (holidays.data ?? []) as SlaHoliday[],
    targets: (targets.data ?? []).map((t) => ({
      category: t.category,
      priority: t.priority as Priority,
      accept_hours: Number(t.accept_hours),
      attention_hours: Number(t.attention_hours),
    })) as SlaTarget[],
    versions: (versions.data ?? []) as SlaVersion[],
    settings: (settings.data ?? null) as NotificationSettings | null,
    departments: departments.data ?? [],
    people,
  };
}

export type OutboxItem = {
  id: string;
  kind: string;
  urgency: string;
  channel: string;
  address: string;
  status: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  deferred_reason: string | null;
  provider_message_id: string | null;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
};

export async function getDeliveryMonitor(member: Member) {
  const supabase = await createClient();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [outbox, counts, jobs, events] = await Promise.all([
    supabase
      .from("outbox")
      .select("id, kind, urgency, channel, address, status, attempts, max_attempts, next_attempt_at, deferred_reason, provider_message_id, last_error, created_at, sent_at")
      .eq("org_id", member.orgId)
      .order("created_at", { ascending: false })
      .limit(60),
    supabase.from("outbox").select("status").eq("org_id", member.orgId).gte("created_at", since).limit(5000),
    supabase
      .from("report_jobs")
      .select("id, kind, period_start, period_end, stage, attempts, last_error, report_id, auto_approve, updated_at")
      .eq("org_id", member.orgId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("notification_events")
      .select("id, kind, level, phase, deadline, reason, result, created_at, case_id")
      .eq("org_id", member.orgId)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);
  const byStatus: Record<string, number> = {};
  for (const r of counts.data ?? []) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  return { outbox: (outbox.data ?? []) as OutboxItem[], byStatus, jobs: jobs.data ?? [], events: events.data ?? [] };
}

export async function getMyPreferences(member: Member) {
  const supabase = await createClient();
  const [pref, settings, contact] = await Promise.all([
    supabase.from("notification_preferences").select("email, whatsapp, quiet_start, quiet_end").eq("org_id", member.orgId).eq("user_id", member.userId).maybeSingle(),
    supabase.from("notification_settings").select("quiet_start, quiet_end").eq("org_id", member.orgId).maybeSingle(),
    supabase.from("whatsapp_contacts").select("status").eq("org_id", member.orgId).eq("user_id", member.userId).maybeSingle(),
  ]);
  return {
    email: pref.data?.email ?? true,
    whatsapp: pref.data?.whatsapp ?? true,
    quiet: pref.data?.quiet_start != null && pref.data?.quiet_end != null ? { start: pref.data.quiet_start, end: pref.data.quiet_end } : null,
    orgQuiet: settings.data ? { start: settings.data.quiet_start, end: settings.data.quiet_end } : { start: 22, end: 7 },
    whatsappActive: contact.data?.status === "active",
  };
}

export type ReapplyRow = {
  case_id: string;
  folio: string;
  status: string;
  version_from: number | null;
  version_to: number | null;
  due_from: string | null;
  due_to: string | null;
  overridden: boolean;
  applies: boolean;
};

/** Open cases whose commitment would change with the current SLA version (admin). */
export async function getSlaReapplyPreview(member: Member): Promise<ReapplyRow[]> {
  if (member.role !== "admin") return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sla_reapply_preview", { p_org_id: member.orgId, p_include_overridden: true });
  if (error) throw new Error(`No se pudo calcular la vista previa del SLA: ${error.message}`);
  return ((data ?? []) as ReapplyRow[]).filter((r) => r.due_from !== r.due_to || r.version_from !== r.version_to);
}
