import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { parseKpiSnapshot, type KpiSnapshot } from "./snapshot";

type Period = { from: Date; to: Date; prevFrom: Date; prevTo: Date; bucket: "hour" | "day" };

/** kpi_snapshot for a period (the caller's session: RLS and role checks in the function). */
export async function getKpiSnapshot(client: SupabaseClient<Database>, orgId: string, period: Period): Promise<KpiSnapshot> {
  const { data, error } = await client.rpc("kpi_snapshot", {
    p_org_id: orgId,
    p_from: period.from.toISOString(),
    p_to: period.to.toISOString(),
    p_prev_from: period.prevFrom.toISOString(),
    p_prev_to: period.prevTo.toISOString(),
    p_bucket: period.bucket,
  });
  if (error) throw new Error(`No se pudieron calcular los indicadores: ${error.message}`);
  return parseKpiSnapshot(data);
}
