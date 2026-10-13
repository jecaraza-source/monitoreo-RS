import "server-only";
import { randomUUID } from "node:crypto";
import { meteredAnthropic } from "@/lib/ai/ledger";
import { AiLimitError } from "@/lib/ai/meter";
import { generateDailyReading } from "@/lib/ai/narrative";
import type { Member } from "@/lib/auth/session";
import { toMxDay } from "@/lib/dashboard/period";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { loadReportFacts } from "./data";
import { rangeLabel, type ReportPeriod } from "./period";

export const READING_TTL_MS = 60 * 60 * 1000;
const HOUR = 3_600_000;
/** Longer than one generation (facts + up to 3 calls); a crashed holder frees it on its own. */
const LEASE_SECONDS = 120;
const LEASE = "daily_reading";

export type DailyReading =
  | { status: "ok"; sentences: string[]; generatedAt: string }
  | { status: "unavailable"; reason: string };

/** The last 24 h (to the next full hour) against the 24 h before. */
export function last24h(now = new Date()): ReportPeriod {
  const to = new Date(Math.ceil(now.getTime() / HOUR) * HOUR);
  const from = new Date(to.getTime() - 24 * HOUR);
  const prevFrom = new Date(from.getTime() - 24 * HOUR);
  const day = toMxDay(new Date(to.getTime() - 1));
  return {
    kind: "daily",
    startDay: toMxDay(from),
    endDay: day,
    from,
    to,
    prevFrom,
    prevTo: from,
    prevStartDay: toMxDay(prevFrom),
    prevEndDay: toMxDay(new Date(from.getTime() - 1)),
    bucket: "hour",
    label: `Últimas 24 horas (al ${rangeLabel("daily", day, day)})`,
    prevLabel: "las 24 horas previas",
  };
}

// One generation per org at a time: across instances by the lease persisted in
// ai_leases; inside this instance the Map also shares the same promise.
const inFlight = new Map<string, Promise<DailyReading>>();

/**
 * "Lectura del día" for the dashboard: cached per org in daily_readings and
 * regenerated with Claude when older than one hour. Readers only read the
 * cache (RLS); the service role writes it.
 */
export async function getDailyReading(member: Member): Promise<DailyReading> {
  const supabase = await createClient();
  const { data: cached } = await supabase
    .from("daily_readings")
    .select("sentences, generated_at")
    .eq("org_id", member.orgId)
    .maybeSingle();
  if (cached && Date.now() - Date.parse(cached.generated_at) < READING_TTL_MS) {
    return { status: "ok", sentences: cached.sentences, generatedAt: cached.generated_at };
  }
  if (!process.env.ANTHROPIC_API_KEY || !process.env.CLAUDE_MODEL_FAST) {
    return cached
      ? { status: "ok", sentences: cached.sentences, generatedAt: cached.generated_at }
      : { status: "unavailable", reason: "Falta configurar la API de Claude." };
  }

  let job = inFlight.get(member.orgId);
  if (!job) {
    job = regenerate(member.orgId).finally(() => inFlight.delete(member.orgId));
    inFlight.set(member.orgId, job);
  }
  const fresh = await job;
  // On failure keep showing the previous reading, if any.
  if (fresh.status === "unavailable" && cached) return { status: "ok", sentences: cached.sentences, generatedAt: cached.generated_at };
  return fresh;
}

async function regenerate(orgId: string): Promise<DailyReading> {
  const admin = createAdminClient();
  const holder = randomUUID();
  const { data: acquired, error: leaseError } = await admin.rpc("acquire_ai_lease", {
    p_org_id: orgId,
    p_name: LEASE,
    p_holder: holder,
    p_ttl_seconds: LEASE_SECONDS,
  });
  if (leaseError) {
    console.error("[daily-reading] lease:", leaseError.message);
    return { status: "unavailable", reason: "No se pudo redactar la lectura en este momento." };
  }
  // Another instance is writing it: show the previous one meanwhile (getDailyReading falls back).
  if (!acquired) return { status: "unavailable", reason: "La lectura del día se está actualizando; vuelve en un momento." };
  try {
    // The lease holder re-checks: another instance may have just finished it.
    const { data: fresh } = await admin.from("daily_readings").select("sentences, generated_at").eq("org_id", orgId).maybeSingle();
    if (fresh && Date.now() - Date.parse(fresh.generated_at) < READING_TTL_MS) {
      return { status: "ok", sentences: fresh.sentences, generatedAt: fresh.generated_at };
    }
    const facts = await loadReportFacts(admin, orgId, last24h());
    if (!facts.kpis.find((k) => k.key === "mentions")?.value) {
      return { status: "unavailable", reason: "Sin menciones en las últimas 24 horas." };
    }
    const model = process.env.CLAUDE_MODEL_FAST!;
    // Org-level work (whoever opens the dashboard): no per-user quota, budgets and concurrency apply.
    const client = meteredAnthropic({ orgId, userId: null, purpose: "daily_reading", ttlSeconds: LEASE_SECONDS });
    const { sentences } = await generateDailyReading(client, model, facts);
    const generatedAt = new Date().toISOString();
    const { error } = await admin
      .from("daily_readings")
      .upsert({ org_id: orgId, sentences, facts: facts as never, model, generated_at: generatedAt });
    if (error) console.error("[daily-reading] save:", error.message);
    return { status: "ok", sentences, generatedAt };
  } catch (error) {
    if (error instanceof AiLimitError) return { status: "unavailable", reason: error.message };
    console.error("[daily-reading]", error instanceof Error ? error.message : error);
    return { status: "unavailable", reason: "No se pudo redactar la lectura en este momento." };
  } finally {
    const { error } = await admin.rpc("release_ai_lease", { p_org_id: orgId, p_name: LEASE, p_holder: holder });
    if (error) console.error("[daily-reading] release lease:", error.message);
  }
}
