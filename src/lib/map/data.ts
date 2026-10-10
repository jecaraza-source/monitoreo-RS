import "server-only";
import type { Member } from "@/lib/auth/session";
import type { Period } from "@/lib/dashboard/period";
import type { Sentiment } from "@/lib/inbox/model";
import { createClient } from "@/lib/supabase/server";
import { buildMapStats, type MapFilters, type MapStats } from "./model";

export type Geometry = { type: "Polygon" | "MultiPolygon"; coordinates: unknown };

export type MapPage = MapStats & {
  shapes: { id: string; geometry: Geometry }[];
  departments: { id: string; name: string }[];
  /** Colonias in the catalog without a polygon (not drawable). */
  withoutShape: number;
};

function geometryOf(geo: unknown): Geometry | null {
  const g = geo as { type?: string; geometry?: unknown } | null;
  // Stored as a bare geometry or as a Feature.
  const geometry = (g && "geometry" in g ? g.geometry : g) as Geometry | null;
  return geometry && (geometry.type === "Polygon" || geometry.type === "MultiPolygon") ? geometry : null;
}

/** Stats per colonia (user session, so RLS and map_stats' role check apply), polygons and filter options. */
export async function getMapPage(member: Member, period: Period, filters: MapFilters): Promise<MapPage> {
  const supabase = await createClient();
  const [stats, neighborhoods, departments] = await Promise.all([
    supabase.rpc("map_stats", {
      p_org_id: member.orgId,
      p_from: period.from.toISOString(),
      p_to: period.to.toISOString(),
      p_prev_from: period.prevFrom.toISOString(),
      p_topic: filters.tema,
      p_department: filters.dependencia,
      p_sentiment: filters.sentimiento,
    }),
    supabase.from("neighborhoods").select("id, name, geojson, shape_source").eq("org_id", member.orgId).order("name"),
    supabase.from("departments").select("id, name").eq("org_id", member.orgId).order("name"),
  ]);
  if (stats.error) throw new Error(`No se pudo cargar el mapa: ${stats.error.message}`);

  const drawable = (neighborhoods.data ?? []).flatMap((n) => {
    const geometry = geometryOf(n.geojson);
    return geometry ? [{ id: n.id, name: n.name, approx: n.shape_source === "osm_approx", geometry }] : [];
  });
  return {
    ...buildMapStats(stats.data as Record<string, unknown> | null, drawable),
    shapes: drawable.map(({ id, geometry }) => ({ id, geometry })),
    departments: departments.data ?? [],
    withoutShape: (neighborhoods.data?.length ?? 0) - drawable.length,
  };
}

export type NeighborhoodDetail = {
  id: string;
  name: string;
  approx: boolean;
  totals: { mentions: number; complaints: number; positive: number; neutral: number; negative: number };
  topics: { topic: string; total: number; negative: number; complaints: number }[];
  tickets: { id: string; name: string; open: number; overdue: number; resolved: number }[];
  latest: { id: string; text: string; url: string | null; published_at: string; sentiment: Sentiment | null; topic: string | null }[];
};

export async function getNeighborhoodDetail(member: Member, neighborhoodId: string, period: Period): Promise<NeighborhoodDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("neighborhood_detail", {
    p_org_id: member.orgId,
    p_neighborhood_id: neighborhoodId,
    p_from: period.from.toISOString(),
    p_to: period.to.toISOString(),
  });
  if (error) throw new Error(`No se pudo cargar la colonia: ${error.message}`);
  if (!data) return null;
  const d = data as Omit<NeighborhoodDetail, "approx"> & { shape_source: string | null };
  return { ...d, approx: d.shape_source === "osm_approx" };
}
