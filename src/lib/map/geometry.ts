// Geometries of the colonias as they come from the catalog (GeoJSON that an
// admin uploaded or OSM produced). Pure. A colonia whose geometry fails here
// is not drawn and the map says why, instead of breaking the whole map.

export type Geometry = { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };
export type GeometryCheck = { ok: true; geometry: Geometry } | { ok: false; reason: GeometryProblem };
export type GeometryProblem = "missing" | "type" | "coordinates" | "ring" | "range" | "size";

export const GEOMETRY_PROBLEMS: Record<GeometryProblem, string> = {
  missing: "Sin polígono",
  type: "Polígono inválido: no es Polygon ni MultiPolygon",
  coordinates: "Polígono inválido: coordenadas mal formadas",
  ring: "Polígono inválido: un anillo no cierra o tiene menos de 4 puntos",
  range: "Polígono inválido: coordenadas fuera de rango (¿latitud y longitud invertidas?)",
  size: "Polígono demasiado detallado para dibujarlo (más de 20 000 vértices)",
};

/** Vertices per colonia the browser draws comfortably. */
export const MAX_VERTICES = 20_000;

const isPosition = (p: unknown): p is number[] =>
  Array.isArray(p) && p.length >= 2 && typeof p[0] === "number" && typeof p[1] === "number" && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** Checks structure, closed rings, coordinate ranges and size. */
export function validateGeometry(raw: unknown): GeometryCheck {
  if (raw === null || raw === undefined) return { ok: false, reason: "missing" };
  const g = raw as { type?: unknown; geometry?: unknown; coordinates?: unknown };
  const geometry = (g && typeof g === "object" && "geometry" in g ? g.geometry : g) as { type?: unknown; coordinates?: unknown } | null;
  if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) return { ok: false, reason: "type" };
  const polygons = (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates) as unknown;
  if (!Array.isArray(polygons) || !polygons.length) return { ok: false, reason: "coordinates" };
  let vertices = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) return { ok: false, reason: "coordinates" };
    for (const ring of polygon) {
      if (!Array.isArray(ring) || !ring.every(isPosition)) return { ok: false, reason: "coordinates" };
      if (ring.length < 4) return { ok: false, reason: "ring" };
      const [a, b] = [ring[0], ring[ring.length - 1]];
      if (a[0] !== b[0] || a[1] !== b[1]) return { ok: false, reason: "ring" };
      if (ring.some(([lng, lat]) => lng < -180 || lng > 180 || lat < -90 || lat > 90)) return { ok: false, reason: "range" };
      vertices += ring.length;
    }
  }
  if (vertices > MAX_VERTICES) return { ok: false, reason: "size" };
  return { ok: true, geometry: geometry as Geometry };
}

/** Ray casting over every ring of every polygon (holes subtract). Same rule as private.point_in_geojson. */
export function pointInGeometry(geometry: Geometry, lng: number, lat: number): boolean {
  const polygons = (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates) as number[][][][];
  return polygons.some((polygon) => {
    const inRing = (ring: number[][]) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    return inRing(polygon[0]) && !polygon.slice(1).some(inRing);
  });
}

/** Coordinates rounded to `decimals` (5 ≈ 1 m): the same shape, a lighter page. */
export function quantize(geometry: Geometry, decimals = 5): Geometry {
  const f = 10 ** decimals;
  const round = (v: unknown): unknown => (typeof v === "number" ? Math.round(v * f) / f : Array.isArray(v) ? v.map(round) : v);
  return { type: geometry.type, coordinates: round(geometry.coordinates) } as Geometry;
}
