// Parses an uploaded GeoJSON of neighborhoods (colonias) into {name, geometry}
// rows. Pure: runs in the browser for the preview and on the server before
// writing, so a crafted request cannot bypass the checks.

import { normalizeText } from "../query/normalize.ts";

export type NeighborhoodGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export type NeighborhoodFeature = { name: string; geometry: NeighborhoodGeometry };

export type GeoJsonParseResult =
  | {
      ok: true;
      features: NeighborhoodFeature[];
      /** Property the names were read from. */
      nameProperty: string;
      /** Properties that could hold the name, for letting the user pick another. */
      candidateProperties: string[];
      skipped: { index: number; reason: string }[];
    }
  | { ok: false; message: string };

const NAME_PROPERTY_GUESSES = ["name", "nombre", "colonia", "nom_col", "nom_asen", "asentamiento", "NOMBRE", "NOM_COL", "COLONIA"];
export const MAX_NEIGHBORHOODS = 2000;

const isPosition = (p: unknown) =>
  Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every((n) => typeof n === "number" && Number.isFinite(n));
const isRing = (r: unknown) => Array.isArray(r) && r.length >= 4 && r.every(isPosition);
const isPolygon = (c: unknown) => Array.isArray(c) && c.length > 0 && c.every(isRing);

function geometryOf(value: unknown): NeighborhoodGeometry | null {
  if (!value || typeof value !== "object") return null;
  const { type, coordinates } = value as { type?: unknown; coordinates?: unknown };
  if (type === "Polygon" && isPolygon(coordinates)) return { type, coordinates: coordinates as number[][][] };
  if (type === "MultiPolygon" && Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(isPolygon)) {
    return { type, coordinates: coordinates as number[][][][] };
  }
  return null;
}

function textProperties(features: { properties?: unknown }[]): string[] {
  const keys = new Set<string>();
  for (const feature of features.slice(0, 50)) {
    const props = feature.properties;
    if (!props || typeof props !== "object") continue;
    for (const [key, value] of Object.entries(props)) {
      if (typeof value === "string" && value.trim()) keys.add(key);
    }
  }
  return [...keys];
}

export function parseNeighborhoodsGeoJson(input: unknown, nameProperty?: string): GeoJsonParseResult {
  if (!input || typeof input !== "object" || (input as { type?: unknown }).type !== "FeatureCollection") {
    return { ok: false, message: "El archivo debe ser un GeoJSON de tipo FeatureCollection." };
  }
  const features = (input as { features?: unknown }).features;
  if (!Array.isArray(features) || features.length === 0) {
    return { ok: false, message: "El GeoJSON no tiene polígonos (features)." };
  }
  if (features.length > MAX_NEIGHBORHOODS) {
    return { ok: false, message: `El archivo tiene ${features.length} polígonos; el máximo es ${MAX_NEIGHBORHOODS}.` };
  }

  const candidateProperties = textProperties(features);
  const property =
    nameProperty ??
    NAME_PROPERTY_GUESSES.find((guess) => candidateProperties.includes(guess)) ??
    candidateProperties[0];
  if (!property) {
    return { ok: false, message: "Ningún polígono tiene una propiedad de texto con el nombre de la colonia." };
  }

  const byName = new Map<string, NeighborhoodFeature>();
  const skipped: { index: number; reason: string }[] = [];
  features.forEach((feature: { properties?: Record<string, unknown>; geometry?: unknown }, index) => {
    const raw = feature?.properties?.[property];
    const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, 120) : "";
    if (!name) return skipped.push({ index, reason: `Sin "${property}"` });
    const geometry = geometryOf(feature?.geometry);
    if (!geometry) return skipped.push({ index, reason: "Geometría no es Polygon/MultiPolygon válido" });
    const key = normalizeText(name);
    if (byName.has(key)) return skipped.push({ index, reason: `Nombre repetido: ${name}` });
    byName.set(key, { name, geometry });
  });

  if (byName.size === 0) {
    return { ok: false, message: "No se encontró ningún polígono válido con nombre." };
  }
  return { ok: true, features: [...byName.values()], nameProperty: property, candidateProperties, skipped };
}
