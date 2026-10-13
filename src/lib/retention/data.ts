import "server-only";
import type { Member } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type RetentionPreview = { cutoff: string; older: number; kept_in_case: number; kept_by_hold: number; deletable: number };

export async function getRetention(member: Member) {
  const supabase = await createClient();
  const fallbackMonths = Number(process.env.RETENTION_MONTHS ?? 24);
  const [policy, holds, purges] = await Promise.all([
    supabase.from("retention_policies").select("mention_months, agreement_reference, agreement_date, notes, paused, updated_at").eq("org_id", member.orgId).maybeSingle(),
    supabase
      .from("retention_holds")
      .select("id, covers_from, covers_to, reason, reference, created_at, released_at, release_reason")
      .eq("org_id", member.orgId)
      .order("created_at", { ascending: false }),
    supabase.from("audit_log").select("created_at, changes").eq("org_id", member.orgId).eq("action", "purge").order("created_at", { ascending: false }).limit(10),
  ]);
  // Without a policy row the deployment value applies; a row without months means no automatic deletion.
  const months = policy.data ? policy.data.mention_months : fallbackMonths;
  const preview = months
    ? await supabase.rpc("retention_preview", { p_org_id: member.orgId, p_months: months })
    : { data: null, error: null };
  if (preview.error) throw new Error(`No se pudo calcular la vista previa: ${preview.error.message}`);
  return {
    policy: policy.data,
    fallbackMonths,
    effectiveMonths: months,
    preview: preview.data as RetentionPreview | null,
    holds: holds.data ?? [],
    purges: (purges.data ?? []).map((p) => ({ at: p.created_at, ...(p.changes as { deleted?: number; months?: number; basis?: string }) })),
  };
}
