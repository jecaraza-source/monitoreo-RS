import "server-only";
import type { Member } from "@/lib/auth/session";
import type { Period } from "@/lib/dashboard/period";
import { dayEnd, dayStart, type Priority, type Sentiment } from "@/lib/inbox/model";
import { createClient } from "@/lib/supabase/server";
import { redactPersonalData } from "@/lib/text/redact";
import { buildCaseLayer, caseRowFilters, type CaseLayer, type CaseMapRow } from "./cases";
import { GEOMETRY_PROBLEMS, quantize, validateGeometry, type Geometry } from "./geometry";
import { buildMapStats, type MapFilters, type MapStats } from "./model";

export type { Geometry } from "./geometry";

export type Colonia = { id: string; name: string; approx: boolean; drawable: boolean; problem: string | null; geometry: Geometry | null };

/** The catalog with each geometry checked: invalid ones are listed with the reason instead of drawn. */
export async function getColonias(member: Member): Promise<Colonia[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("neighborhoods").select("id, name, geojson, shape_source").eq("org_id", member.orgId).order("name");
  if (error) throw new Error(`No se pudo cargar el catálogo de colonias: ${error.message}`);
  return (data ?? []).map((n) => {
    const check = validateGeometry(n.geojson);
    return {
      id: n.id,
      name: n.name,
      approx: n.shape_source === "osm_approx",
      drawable: check.ok,
      problem: check.ok ? null : GEOMETRY_PROBLEMS[check.reason],
      geometry: check.ok ? quantize(check.geometry) : null,
    };
  });
}

/**
 * The period as whole Mexico City days (the inbox and /casos filter by day),
 * so the map's counts are the ones those pages show for the same filters.
 */
export function dayBounds(period: Period) {
  const from = new Date(dayStart(period.fromDay));
  const to = new Date(dayEnd(period.toDay));
  return { from, to, prevFrom: new Date(from.getTime() - (to.getTime() - from.getTime())) };
}

export type UnlocatedMentions = {
  count: number;
  complaints: number;
  items: { id: string; published_at: string; topic: string | null; sentiment: Sentiment | null; priority: Priority | null; complaint: boolean }[];
};

export type ConversationLayer = MapStats & { unlocatedMentions: UnlocatedMentions };

/** Conversation layer (admin, comunicación, lectura): map_stats and the mentions without colonia. */
export async function getConversationLayer(member: Member, period: Period, filters: MapFilters, colonias: Colonia[]): Promise<ConversationLayer> {
  const supabase = await createClient();
  const { from, to, prevFrom } = dayBounds(period);
  const [stats, unlocated] = await Promise.all([
    supabase.rpc("map_stats", {
      p_org_id: member.orgId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_prev_from: prevFrom.toISOString(),
      p_topic: filters.tema,
      p_department: filters.dependencia,
      p_sentiment: filters.sentimiento,
    }),
    supabase.rpc("map_unlocated_mentions", {
      p_org_id: member.orgId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_topic: filters.tema,
      p_department: filters.dependencia,
      p_sentiment: filters.sentimiento,
      p_limit: 50,
    }),
  ]);
  if (stats.error) throw new Error(`No se pudo cargar el mapa: ${stats.error.message}`);
  if (unlocated.error) throw new Error(`No se pudieron cargar las menciones sin colonia: ${unlocated.error.message}`);
  return {
    ...buildMapStats(stats.data as Record<string, unknown> | null, colonias.map(({ id, name, approx }) => ({ id, name, approx }))),
    unlocatedMentions: unlocated.data as unknown as UnlocatedMentions,
  };
}

/** Cases layer (every role): the cases RLS lets this member see, with the map's filters. */
export async function getCaseLayer(member: Member, period: Period, filters: MapFilters, colonias: Colonia[]): Promise<CaseLayer> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("map_case_rows", {
    p_org_id: member.orgId,
    // The colonia filter selects in the panel; the layer always shows every colonia.
    p_filters: { ...caseRowFilters({ ...filters, colonia: undefined }, period) },
  });
  if (error) throw new Error(`No se pudieron cargar los casos del mapa: ${error.message}`);
  return buildCaseLayer(
    (data ?? []) as unknown as CaseMapRow[],
    colonias.map(({ id, name, approx, drawable, problem }) => ({ id, name, approx, drawable, problem })),
  );
}

export async function getDepartments(member: Member): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("departments").select("id, name").eq("org_id", member.orgId).order("name");
  return data ?? [];
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
  const { from, to } = dayBounds(period);
  const { data, error } = await supabase.rpc("neighborhood_detail", {
    p_org_id: member.orgId,
    p_neighborhood_id: neighborhoodId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (error) throw new Error(`No se pudo cargar la colonia: ${error.message}`);
  if (!data) return null;
  const d = data as Omit<NeighborhoodDetail, "approx"> & { shape_source: string | null };
  // Public posts, but an executive screen: e-mails, phones and house numbers masked.
  return { ...d, approx: d.shape_source === "osm_approx", latest: d.latest.map((m) => ({ ...m, text: redactPersonalData(m.text) })) };
}
