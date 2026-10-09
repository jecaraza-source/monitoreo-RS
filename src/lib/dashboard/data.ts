import "server-only";
import type { Member } from "@/lib/auth/session";
import { SOURCE_LABELS } from "@/lib/inbox/model";
import { createClient } from "@/lib/supabase/server";
import { parseDashboard, type DashboardData } from "./model";
import type { Period } from "./period";

export type NeighborhoodShape = {
  id: string;
  name: string;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown } | null;
};

export type Dashboard = DashboardData & { neighborhoodShapes: NeighborhoodShape[] };

/**
 * Everything the dashboard shows for a period: two calls to dashboard_stats
 * (current with detail, previous totals only) plus the catalogs that name ids.
 */
export async function getDashboard(member: Member, period: Period): Promise<Dashboard> {
  const supabase = await createClient();
  const [current, previous, departments, sources, neighborhoods] = await Promise.all([
    supabase.rpc("dashboard_stats", {
      p_org_id: member.orgId,
      p_from: period.from.toISOString(),
      p_to: period.to.toISOString(),
      p_bucket: period.bucket,
      p_detail: true,
    }),
    supabase.rpc("dashboard_stats", {
      p_org_id: member.orgId,
      p_from: period.prevFrom.toISOString(),
      p_to: period.prevTo.toISOString(),
      p_bucket: period.bucket,
      p_detail: false,
    }),
    supabase.from("departments").select("id, name").eq("org_id", member.orgId),
    supabase.rpc("source_labels", { p_org_id: member.orgId }),
    supabase.from("neighborhoods").select("id, name, geojson").eq("org_id", member.orgId).order("name"),
  ]);
  if (current.error) throw new Error(`No se pudo cargar el dashboard: ${current.error.message}`);

  const data = parseDashboard(
    (current.data ?? {}) as Record<string, unknown>,
    (previous.data ?? {}) as Record<string, unknown>,
    new Map((departments.data ?? []).map((d) => [d.id, d.name])),
    new Map((sources.data ?? []).map((s) => [s.id, `${SOURCE_LABELS[s.type]} · ${s.name}`])),
  );

  return {
    ...data,
    neighborhoodShapes: (neighborhoods.data ?? []).map((n) => {
      const geo = n.geojson as { type?: string; coordinates?: unknown; geometry?: unknown } | null;
      // Stored as a bare geometry or as a Feature.
      const geometry = (geo && "geometry" in geo ? geo.geometry : geo) as NeighborhoodShape["geometry"];
      return {
        id: n.id,
        name: n.name,
        geometry: geometry && (geometry.type === "Polygon" || geometry.type === "MultiPolygon") ? geometry : null,
      };
    }),
  };
}
