import "server-only";
import type { Member } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { onboardingChecklist, type CheckItem, type OnboardingFacts } from "./onboarding";
import { CONFIG_ELEMENTS } from "./registry";

export type LastChange = { at: string; actor: string; action: string; entity: string };

const count = (r: { count: number | null }) => r.count ?? 0;

/** Last audited change of each configuration element (admin reads audit_log; null for others). */
export async function getLastChanges(member: Member): Promise<Record<string, LastChange | null> | null> {
  if (member.role !== "admin") return null;
  const supabase = await createClient();
  const entities = [...new Set(CONFIG_ELEMENTS.flatMap((e) => e.audited))];
  const { data, error } = await supabase
    .from("audit_log")
    .select("entity, action, created_at, actor_id")
    .eq("org_id", member.orgId)
    .in("entity", entities)
    .neq("action", "export")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`No se pudo leer la bitácora: ${error.message}`);
  const actors = [...new Set((data ?? []).map((r) => r.actor_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (actors.length) {
    const { data: people } = await supabase.rpc("org_members", { p_org_id: member.orgId });
    for (const p of people ?? []) names.set(p.user_id, p.email);
  }
  const latest = new Map<string, LastChange>();
  for (const r of data ?? []) {
    if (!latest.has(r.entity)) {
      latest.set(r.entity, { at: r.created_at, actor: r.actor_id ? (names.get(r.actor_id) ?? "Usuario") : "Sistema", action: r.action, entity: r.entity });
    }
  }
  return Object.fromEntries(
    CONFIG_ELEMENTS.map((e) => {
      const changes = e.audited.map((a) => latest.get(a)).filter(Boolean) as LastChange[];
      return [e.key, changes.sort((a, b) => b.at.localeCompare(a.at))[0] ?? null];
    }),
  );
}

/** The start-of-operation checklist (admin: org_members and audit data are admin-only). */
export async function getOnboarding(member: Member): Promise<CheckItem[]> {
  const supabase = await createClient();
  const org = member.orgId;
  const [departments, neighborhoods, categories, capabilities, members, sources, authors, version, retention, limits, manual] = await Promise.all([
    supabase.from("departments").select("id, responsible_user_id, head_user_id").eq("org_id", org),
    supabase.from("neighborhoods").select("id", { count: "exact", head: true }).eq("org_id", org),
    supabase.from("case_categories").select("id").eq("org_id", org).eq("active", true),
    supabase.from("department_capabilities").select("category_id").eq("org_id", org),
    supabase.rpc("org_members", { p_org_id: org }),
    supabase.from("sources").select("id, last_success_at").eq("org_id", org).eq("is_active", true),
    supabase.from("verified_authors").select("id", { count: "exact", head: true }).eq("org_id", org).is("revoked_at", null),
    supabase.from("sla_versions").select("approved").eq("org_id", org).order("version", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("retention_policies").select("org_id").eq("org_id", org).maybeSingle(),
    supabase.from("ai_limits").select("org_id").eq("org_id", org).maybeSingle(),
    supabase.from("onboarding_checks").select("key, note, done_at, done_by").eq("org_id", org),
  ]);
  const people = members.data ?? [];
  const capable = new Set((capabilities.data ?? []).map((c) => c.category_id));
  const depts = departments.data ?? [];
  const deptsWithUsers = new Set(people.filter((p) => p.role === "dependencia").map((p) => p.department_id));
  const nameOf = new Map(people.map((p) => [p.user_id, p.email]));
  const facts: OnboardingFacts = {
    departments: depts.length,
    neighborhoods: count(neighborhoods),
    categories: (categories.data ?? []).length,
    categoriesWithoutCapability: (categories.data ?? []).filter((c) => !capable.has(c.id)).length,
    departmentsWithoutLink: depts.filter((d) => !d.responsible_user_id).length,
    departmentsWithoutHead: depts.filter((d) => !d.head_user_id).length,
    departmentsWithoutUsers: depts.filter((d) => !deptsWithUsers.has(d.id)).length,
    admins: people.filter((p) => p.role === "admin").length,
    comunicacion: people.filter((p) => p.role === "comunicacion").length,
    activeSources: (sources.data ?? []).length,
    sourcesReading: (sources.data ?? []).filter((s) => s.last_success_at).length,
    verifiedAuthors: count(authors),
    slaApproved: Boolean(version.data?.approved),
    retentionDecided: Boolean(retention.data),
    aiLimitsSet: Boolean(limits.data),
    manual: Object.fromEntries(
      (manual.data ?? []).map((m) => [m.key, { note: m.note, doneAt: m.done_at, doneBy: nameOf.get(m.done_by) ?? "Administración" }]),
    ),
  };
  return onboardingChecklist(facts);
}
