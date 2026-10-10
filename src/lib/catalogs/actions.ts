"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { parseNeighborhoodsGeoJson, type NeighborhoodGeometry } from "@/lib/geo/neighborhoods-geojson";
import { approximateZones, OVERPASS_URL, overpassQuery, parseOverpass, type OsmZone } from "@/lib/geo/osm";
import { normalizeText } from "@/lib/query/normalize";
import { createClient } from "@/lib/supabase/server";

export type CatalogResult = { ok: true; message: string } | { ok: false; message: string };

const CATALOG_PATH = "/configuracion/catalogos";

async function adminOrg(): Promise<string | null> {
  try {
    return (await requireRole(["admin"])).orgId;
  } catch {
    return null;
  }
}

const FORBIDDEN: CatalogResult = { ok: false, message: "Sólo un administrador puede editar catálogos." };

function dbError(code: string | undefined, what: string): CatalogResult {
  if (code === "23505") return { ok: false, message: `Ya existe ${what} con ese nombre.` };
  if (code === "23503") return { ok: false, message: `No se puede borrar: hay registros que usan ${what}.` };
  console.error("[catalogs]", what, code);
  return { ok: false, message: "No se pudo guardar el cambio." };
}

const name = z.string().trim().min(2, "El nombre es muy corto.").max(120);

/**
 * Names are unique per org ignoring case and accents ("Protección Civil" =
 * "proteccion civil"). The DB constraint is exact-match, so check here.
 */
async function nameTaken(
  table: "departments" | "neighborhoods",
  orgId: string,
  candidate: string,
  exceptId?: string,
): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from(table).select("id, name").eq("org_id", orgId);
  const key = normalizeText(candidate);
  return (data ?? []).some((row) => row.id !== exceptId && normalizeText(row.name) === key);
}
const id = z.guid("Identificador inválido.");

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

export async function saveDepartment(input: { id?: string; name: string; shortName?: string }): Promise<CatalogResult> {
  const orgId = await adminOrg();
  if (!orgId) return FORBIDDEN;
  const parsed = z
    .object({ id: id.optional(), name, shortName: z.string().trim().max(30).optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  if (await nameTaken("departments", orgId, parsed.data.name, parsed.data.id)) {
    return { ok: false, message: "Ya existe una dependencia con ese nombre." };
  }
  const supabase = await createClient();
  const row = { name: parsed.data.name, short_name: parsed.data.shortName || null };
  const { error } = parsed.data.id
    ? await supabase.from("departments").update(row).eq("id", parsed.data.id).eq("org_id", orgId)
    : await supabase.from("departments").insert({ ...row, org_id: orgId });
  if (error) return dbError(error.code, "una dependencia");
  revalidatePath(CATALOG_PATH);
  return { ok: true, message: parsed.data.id ? "Dependencia actualizada." : "Dependencia agregada." };
}

export async function deleteDepartment(departmentId: string): Promise<CatalogResult> {
  const orgId = await adminOrg();
  if (!orgId) return FORBIDDEN;
  if (!id.safeParse(departmentId).success) return { ok: false, message: "Dependencia inválida." };
  const supabase = await createClient();
  const { error } = await supabase.from("departments").delete().eq("id", departmentId).eq("org_id", orgId);
  if (error) return dbError(error.code, "esta dependencia");
  revalidatePath(CATALOG_PATH);
  return { ok: true, message: "Dependencia eliminada." };
}

// ---------------------------------------------------------------------------
// Neighborhoods
// ---------------------------------------------------------------------------

export async function saveNeighborhood(input: { id?: string; name: string }): Promise<CatalogResult> {
  const orgId = await adminOrg();
  if (!orgId) return FORBIDDEN;
  const parsed = z.object({ id: id.optional(), name }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  if (await nameTaken("neighborhoods", orgId, parsed.data.name, parsed.data.id)) {
    return { ok: false, message: "Ya existe una colonia con ese nombre." };
  }
  const supabase = await createClient();
  const { error } = parsed.data.id
    ? await supabase.from("neighborhoods").update({ name: parsed.data.name }).eq("id", parsed.data.id).eq("org_id", orgId)
    : await supabase.from("neighborhoods").insert({ name: parsed.data.name, org_id: orgId });
  if (error) return dbError(error.code, "una colonia");
  revalidatePath(CATALOG_PATH);
  return { ok: true, message: parsed.data.id ? "Colonia actualizada." : "Colonia agregada." };
}

export async function deleteNeighborhood(neighborhoodId: string): Promise<CatalogResult> {
  const orgId = await adminOrg();
  if (!orgId) return FORBIDDEN;
  if (!id.safeParse(neighborhoodId).success) return { ok: false, message: "Colonia inválida." };
  const supabase = await createClient();
  const { error } = await supabase.from("neighborhoods").delete().eq("id", neighborhoodId).eq("org_id", orgId);
  if (error) return dbError(error.code, "esta colonia");
  revalidatePath(CATALOG_PATH);
  return { ok: true, message: "Colonia eliminada." };
}

type ShapeSource = "file" | "osm" | "osm_approx";

/**
 * Imports a GeoJSON FeatureCollection: creates new neighborhoods and replaces
 * the geometry of existing ones with the same name. The file is re-validated
 * here; the browser-side parse is only a preview. `origin` "osm" comes from the
 * OpenStreetMap preview below and marks zones derived from points.
 */
export async function importNeighborhoods(geojson: unknown, nameProperty: string, origin: unknown = "file"): Promise<CatalogResult> {
  const orgId = await adminOrg();
  if (!orgId) return FORBIDDEN;
  // The geometry is checked structurally by parseNeighborhoodsGeoJson (rings, positions, limits).
  const input = z
    .object({ nameProperty: z.string().trim().min(1, "Elige la propiedad con el nombre.").max(80), origin: z.enum(["file", "osm"]) })
    .safeParse({ nameProperty, origin });
  if (!input.success) return { ok: false, message: input.error.issues[0].message };
  const parsed = parseNeighborhoodsGeoJson(geojson, input.data.nameProperty);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  const supabase = await createClient();
  const { data: existing } = await supabase.from("neighborhoods").select("name").eq("org_id", orgId);
  // Match file names to catalog names ignoring case/accents, and write under
  // the existing spelling so the upsert updates that row instead of adding a twin.
  const existingByKey = new Map((existing ?? []).map((n) => [normalizeText(n.name), n.name]));
  const rows = new Map<string, { org_id: string; name: string; geojson: NeighborhoodGeometry; shape_source: ShapeSource }>();
  for (const f of parsed.features) {
    const key = normalizeText(f.name);
    const shape_source: ShapeSource = input.data.origin === "file" ? "file" : f.approx ? "osm_approx" : "osm";
    rows.set(key, { org_id: orgId, name: existingByKey.get(key) ?? f.name, geojson: f.geometry, shape_source });
  }

  const { error } = await supabase.from("neighborhoods").upsert([...rows.values()], { onConflict: "org_id,name" });
  if (error) return dbError(error.code, "una colonia");

  const updated = [...rows.keys()].filter((key) => existingByKey.has(key)).length;
  const created = rows.size - updated;
  revalidatePath(CATALOG_PATH);
  revalidatePath("/mapa");
  const skipped = parsed.skipped.length ? `, ${parsed.skipped.length} omitidas` : "";
  return { ok: true, message: `Colonias: ${created} nuevas, ${updated} actualizadas${skipped}.` };
}

export type OsmPreview = { ok: true; municipality: string; zones: OsmZone[] } | { ok: false; message: string };

const placeName = z
  .string()
  .trim()
  .min(2, "Escribe el nombre completo.")
  .max(80)
  .regex(/^[\p{L}\p{M} .'()-]+$/u, "Usa sólo letras, espacios y acentos.");

/**
 * Looks up the colonias and localities of a municipality in OpenStreetMap
 * (Overpass API, from the server) and returns them as polygons for the
 * preview. Nothing is saved until the admin imports the selection.
 */
export async function previewOsmNeighborhoods(input: unknown): Promise<OsmPreview> {
  const orgId = await adminOrg();
  if (!orgId) return { ok: false, message: FORBIDDEN.message };
  const parsed = z.object({ municipality: placeName, state: placeName }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  let json: unknown;
  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "SigmaPulso/1.0 (monitoreo municipal)" },
      body: new URLSearchParams({ data: overpassQuery(parsed.data.municipality, parsed.data.state) }),
      signal: AbortSignal.timeout(75_000),
      cache: "no-store",
    });
    if (res.status === 429 || res.status === 504) {
      return { ok: false, message: "OpenStreetMap está saturado. Intenta de nuevo en un minuto." };
    }
    if (!res.ok) return { ok: false, message: `OpenStreetMap respondió ${res.status}.` };
    json = await res.json();
  } catch (error) {
    console.error("[catalogs] overpass:", error instanceof Error ? error.message : error);
    return { ok: false, message: "No se pudo consultar OpenStreetMap. Intenta de nuevo." };
  }

  const result = parseOverpass(json);
  if (!result.ok) return result;
  if (!result.places.length) {
    return { ok: false, message: `OpenStreetMap no tiene colonias ni localidades con nombre en ${result.municipality}.` };
  }
  return { ok: true, municipality: result.municipality, zones: approximateZones(result.places) };
}

// ---------------------------------------------------------------------------
// Risk terms (topics that raise priority; never names of people)
// ---------------------------------------------------------------------------

const SEVERITIES = ["low", "medium", "high", "critical"] as const;

export async function saveRiskTerm(input: { term: string; severity: string }): Promise<CatalogResult> {
  const orgId = await adminOrg();
  if (!orgId) return FORBIDDEN;
  const parsed = z
    .object({ term: z.string().trim().min(3, "El término es muy corto.").max(60), severity: z.enum(SEVERITIES) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.from("risk_terms").insert({
    org_id: orgId,
    term: parsed.data.term,
    normalized: normalizeText(parsed.data.term),
    severity: parsed.data.severity,
  });
  if (error) return dbError(error.code, "un término");
  revalidatePath(CATALOG_PATH);
  return { ok: true, message: "Término agregado." };
}

export async function deleteRiskTerm(termId: string): Promise<CatalogResult> {
  const orgId = await adminOrg();
  if (!orgId) return FORBIDDEN;
  if (!id.safeParse(termId).success) return { ok: false, message: "Término inválido." };
  const supabase = await createClient();
  const { error } = await supabase.from("risk_terms").delete().eq("id", termId).eq("org_id", orgId);
  if (error) return dbError(error.code, "este término");
  revalidatePath(CATALOG_PATH);
  return { ok: true, message: "Término eliminado." };
}
