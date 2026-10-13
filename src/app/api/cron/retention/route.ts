import { NextResponse, type NextRequest } from "next/server";
import { cronDisabledHere, isAuthorizedCron } from "@/lib/auth/cron";
import { refreshMentionStats } from "@/lib/dashboard/refresh";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

const BATCH = 5000;
const TIME_BUDGET_MS = 240_000;

/**
 * Daily purge per municipality (stage 11). Each org uses its own retention
 * policy (Configuración → Retención, backed by a municipal agreement); without
 * one, the deployment value RETENTION_MONTHS (default 24, an operating value,
 * not a legal term) applies. A paused policy purges nothing. Mentions that
 * belong to a case or fall under a conservation hold are never deleted
 * (purge_org_mentions). Every batch is recorded in audit_log.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (cronDisabledHere()) return NextResponse.json({ ok: true, skipped: "Los crons sólo corren en producción." });

  const fallback = Number(process.env.RETENTION_MONTHS ?? 24);
  if (!Number.isInteger(fallback) || fallback < 1) {
    return NextResponse.json({ ok: false, error: "RETENTION_MONTHS debe ser un entero de 1 o más." }, { status: 500 });
  }
  const admin = createAdminClient();
  const [orgs, policies] = await Promise.all([
    admin.from("organizations").select("id"),
    admin.from("retention_policies").select("org_id, mention_months, paused, agreement_reference"),
  ]);
  if (orgs.error || policies.error) {
    return NextResponse.json({ ok: false, error: (orgs.error ?? policies.error)!.message }, { status: 500 });
  }
  const byOrg = new Map((policies.data ?? []).map((p) => [p.org_id, p]));
  const started = Date.now();
  const results: { orgId: string; months: number | null; basis: string; deleted: number }[] = [];
  let deleted = 0;
  for (const { id } of orgs.data ?? []) {
    const policy = byOrg.get(id);
    if (policy?.paused) {
      results.push({ orgId: id, months: policy.mention_months, basis: "pausada", deleted: 0 });
      continue;
    }
    // A policy row without months means "never automatically".
    const months = policy ? policy.mention_months : fallback;
    const basis = policy ? `acuerdo: ${policy.agreement_reference ?? ""}` : "valor del despliegue";
    if (!months) {
      results.push({ orgId: id, months: null, basis: "sin eliminación automática", deleted: 0 });
      continue;
    }
    let orgDeleted = 0;
    for (;;) {
      const { data, error } = await admin.rpc("purge_org_mentions", { p_org_id: id, p_months: months, p_batch: BATCH, p_basis: basis });
      if (error) return NextResponse.json({ ok: false, deleted, error: error.message }, { status: 500 });
      orgDeleted += data ?? 0;
      if ((data ?? 0) < BATCH || Date.now() - started > TIME_BUDGET_MS) break;
    }
    deleted += orgDeleted;
    results.push({ orgId: id, months, basis, deleted: orgDeleted });
  }
  if (deleted > 0) await refreshMentionStats(admin);
  const whatsapp = await admin.rpc("purge_old_whatsapp_messages", { p_months: fallback });
  if (whatsapp.error) return NextResponse.json({ ok: false, deleted, error: whatsapp.error.message }, { status: 500 });
  return NextResponse.json({ ok: true, deleted, orgs: results, whatsappDeleted: whatsapp.data ?? 0 });
}
