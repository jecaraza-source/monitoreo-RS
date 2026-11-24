import "server-only";
import type { Member } from "@/lib/auth/session";
import type { Period } from "@/lib/dashboard/period";
import { createClient } from "@/lib/supabase/server";
import { nameWords, parseCriticalVoices, type CriticalVoices } from "./model";

/** The negative conversation of a period and the one before it, aggregated: no authors. */
export async function getCriticalVoices(member: Member, period: Period): Promise<CriticalVoices> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("critical_voices", {
    p_org_id: member.orgId,
    p_from: period.from.toISOString(),
    p_to: period.to.toISOString(),
    p_prev_from: period.prevFrom.toISOString(),
    p_prev_to: period.prevTo.toISOString(),
    p_bucket: period.bucket,
  });
  if (error) throw new Error(`No se pudo cargar Voces críticas: ${error.message}`);
  return parseCriticalVoices((data ?? {}) as Record<string, unknown>, nameWords(member.orgName));
}
