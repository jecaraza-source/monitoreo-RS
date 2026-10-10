// Neighborhoods (colonias) and localities of a municipality from OpenStreetMap.
// Pure: builds the Overpass query, reads its JSON and turns places into
// polygons. Most Mexican towns are mapped as points in OSM (one node per
// colonia or locality, not its outline), so points get an approximate zone:
// the area closer to that point than to any other place (a Voronoi cell),
// capped at a radius that depends on the kind of place.

import { normalizeText } from "../query/normalize.ts";
import type { NeighborhoodGeometry } from "./neighborhoods-geojson.ts";

export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

export type PlaceKind = "town" | "village" | "hamlet" | "suburb" | "neighbourhood" | "residential";

export const PLACE_KIND_LABELS: Record<PlaceKind, string> = {
  town: "Cabecera o ciudad",
  village: "Pueblo",
  hamlet: "Ranchería",
  suburb: "Colonia o barrio",
  neighbourhood: "Colonia o fraccionamiento",
  residential: "Zona habitacional",
};

/** Colonias inside towns vs. localities around them (for the import preview). */
export const URBAN_KINDS: readonly PlaceKind[] = ["suburb", "neighbourhood", "residential"];

// Radius cap of an approximate zone, in meters.
const RADIUS: Record<PlaceKind, number> = {
  town: 2000,
  village: 1000,
  hamlet: 500,
  suburb: 700,
  neighbourhood: 350,
  residential: 300,
};

export type OsmPlace = {
  osmId: string;
  name: string;
  kind: PlaceKind;
  /** [lon, lat] of the node or of the outline's center. */
  center: [number, number];
  /** Outline when OSM has one (closed way). */
  ring?: number[][];
};

export type OsmZone = {
  osmId: string;
  name: string;
  kind: PlaceKind;
  /** True when the polygon was derived from a point, not drawn in OSM. */
  approx: boolean;
  geometry: NeighborhoodGeometry;
};

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

const quote = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const regexLiteral = (s: string) => quote(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

/**
 * Places with a name inside the municipality (admin_level 6 in Mexico) of the
 * given state (admin_level 4; matched by substring, case-sensitive because the
 * case-insensitive regex makes Overpass time out; "Veracruz" finds
 * "Veracruz de Ignacio de la Llave").
 */
export function overpassQuery(municipality: string, state: string): string {
  return [
    "[out:json][timeout:60];",
    `area["boundary"="administrative"]["admin_level"="4"]["name"~"${regexLiteral(state.trim())}"]->.state;`,
    `rel(area.state)["boundary"="administrative"]["admin_level"="6"]["name"="${quote(municipality.trim())}"]->.mun;`,
    ".mun out tags;",
    ".mun map_to_area->.m;",
    "(",
    '  nwr(area.m)["place"~"^(city|town|village|hamlet|suburb|quarter|neighbourhood)$"]["name"];',
    '  way(area.m)["landuse"="residential"]["name"];',
    ");",
    "out geom;",
  ].join("\n");
}

/** "H. Ayuntamiento de Alvarado" → "Alvarado", to prefill the search. */
export function municipalityFromOrgName(name: string): string {
  return name
    .replace(/^\s*(h\.?\s*)?(ayuntamiento|municipio)(\s+constitucional)?\s+de(l)?\s+/i, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: ({ lat: number; lon: number } | null)[];
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
};

export type OsmParseResult =
  | { ok: true; municipality: string; places: OsmPlace[] }
  | { ok: false; message: string };

const SMALL_WORDS = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "en"]);

/** "RESIDENCIAL PLAYA DORADA" → "Residencial Playa Dorada"; mixed-case names stay as typed. */
export function tidyName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, 120);
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .split(" ")
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

function kindOf(tags: Record<string, string>): PlaceKind | null {
  switch (tags.place) {
    case "city":
    case "town":
      return "town";
    case "village":
      return "village";
    case "hamlet":
      return "hamlet";
    case "suburb":
      return "suburb";
    case "quarter":
    case "neighbourhood":
      return "neighbourhood";
  }
  return tags.landuse === "residential" ? "residential" : null;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

function closedRing(geometry: OverpassElement["geometry"]): number[][] | null {
  if (!geometry || geometry.length < 4 || geometry.some((p) => !p || !finite(p.lat) || !finite(p.lon))) return null;
  const ring = geometry.map((p) => [p!.lon, p!.lat]);
  const [a, b] = [ring[0], ring[ring.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? ring : null;
}

function ringCenter(ring: number[][]): [number, number] {
  const pts = ring.slice(0, -1);
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

const KIND_RANK: Record<PlaceKind, number> = { town: 0, suburb: 1, neighbourhood: 2, village: 3, residential: 4, hamlet: 5 };

export function parseOverpass(input: unknown): OsmParseResult {
  const elements = (input as { elements?: unknown })?.elements;
  if (!Array.isArray(elements)) return { ok: false, message: "OpenStreetMap respondió algo inesperado." };
  const all = elements as OverpassElement[];

  const boundary = all.find((e) => e.type === "relation" && e.tags?.boundary === "administrative" && e.tags.admin_level === "6");
  if (!boundary) {
    return { ok: false, message: "No se encontró ese municipio en OpenStreetMap. Revisa el nombre (con acentos) y el estado." };
  }
  const municipality = boundary.tags?.name ?? "";

  const byName = new Map<string, OsmPlace>();
  for (const e of all) {
    if (e === boundary || !e.tags?.name) continue;
    const kind = kindOf(e.tags);
    if (!kind) continue;

    let center: [number, number] | null = null;
    let ring: number[][] | undefined;
    if (e.type === "node" && finite(e.lon) && finite(e.lat)) {
      center = [e.lon, e.lat];
    } else if (e.type === "way") {
      ring = closedRing(e.geometry) ?? undefined;
      if (ring) center = ringCenter(ring);
    } else if (e.type === "relation" && e.bounds) {
      // Multipolygon outlines are not assembled; the relation counts as a point.
      center = [(e.bounds.minlon + e.bounds.maxlon) / 2, (e.bounds.minlat + e.bounds.maxlat) / 2];
    }
    if (!center) continue;

    let name = tidyName(e.tags.name);
    // The town that shares the municipality's name is its seat.
    if (kind === "town" && normalizeText(name) === normalizeText(municipality)) name = `${name} (cabecera)`;

    const place: OsmPlace = { osmId: `${e.type}/${e.id}`, name, kind, center, ...(ring ? { ring } : {}) };
    const key = normalizeText(name);
    const seen = byName.get(key);
    // Same name twice (node + outline, or two tags): keep the outline, then the more specific kind.
    if (!seen || (!seen.ring && ring) || (!!seen.ring === !!ring && KIND_RANK[kind] < KIND_RANK[seen.kind])) {
      byName.set(key, place);
    }
  }

  const places = [...byName.values()].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.name.localeCompare(b.name, "es"));
  return { ok: true, municipality, places };
}

// ---------------------------------------------------------------------------
// Approximate zones
// ---------------------------------------------------------------------------

type XY = [number, number];
const EARTH = 6_371_000;
const SIDES = 32;

/** Equirectangular projection around a latitude: meters, accurate at town scale. */
function projection(lat0: number) {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return {
    to: ([lon, lat]: number[]): XY => [((lon * Math.PI) / 180) * EARTH * k, ((lat * Math.PI) / 180) * EARTH],
    from: ([x, y]: XY): number[] => [
      Math.round(((x / (EARTH * k)) * 180 * 1e6) / Math.PI) / 1e6,
      Math.round(((y / EARTH) * 180 * 1e6) / Math.PI) / 1e6,
    ],
  };
}

/** Keeps the part of a convex polygon on p's side of the bisector between p and q. */
function clipCloserTo(poly: XY[], p: XY, q: XY): XY[] {
  const n: XY = [q[0] - p[0], q[1] - p[1]];
  const m: XY = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const side = (v: XY) => (v[0] - m[0]) * n[0] + (v[1] - m[1]) * n[1]; // <= 0: closer to p
  const out: XY[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const sa = side(a);
    const sb = side(b);
    if (sa <= 0) out.push(a);
    if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

/**
 * One polygon per place: the OSM outline when there is one, otherwise the
 * Voronoi cell of its point among all places, capped by a circle.
 */
export function approximateZones(places: OsmPlace[]): OsmZone[] {
  if (!places.length) return [];
  const proj = projection(places.reduce((s, p) => s + p.center[1], 0) / places.length);
  const xy = places.map((p) => proj.to(p.center));

  return places.flatMap((place, i): OsmZone[] => {
    if (place.ring) {
      return [{ osmId: place.osmId, name: place.name, kind: place.kind, approx: false, geometry: { type: "Polygon", coordinates: [place.ring] } }];
    }
    const [cx, cy] = xy[i];
    const r = RADIUS[place.kind];
    let cell: XY[] = Array.from({ length: SIDES }, (_, k) => {
      const a = (2 * Math.PI * k) / SIDES;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as XY;
    });
    for (let j = 0; j < xy.length && cell.length >= 3; j++) {
      // Only neighbors closer than twice the cap can cut the circle.
      if (j === i || Math.hypot(xy[j][0] - cx, xy[j][1] - cy) >= 2 * r) continue;
      if (xy[j][0] === cx && xy[j][1] === cy) continue;
      cell = clipCloserTo(cell, xy[i], xy[j]);
    }
    if (cell.length < 3) return [];
    const ring = cell.map(proj.from);
    ring.push(ring[0]);
    return [{ osmId: place.osmId, name: place.name, kind: place.kind, approx: true, geometry: { type: "Polygon", coordinates: [ring] } }];
  });
}

/** GeoJSON for the catalog import (parseNeighborhoodsGeoJson reads name and approx). */
export function zonesToGeoJson(zones: OsmZone[]) {
  return {
    type: "FeatureCollection" as const,
    features: zones.map((z) => ({
      type: "Feature" as const,
      properties: { name: z.name, kind: z.kind, approx: z.approx, osm_id: z.osmId },
      geometry: z.geometry,
    })),
  };
}
