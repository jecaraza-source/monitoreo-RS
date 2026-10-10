import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseNeighborhoodsGeoJson } from "./neighborhoods-geojson.ts";
import { approximateZones, municipalityFromOrgName, overpassQuery, parseOverpass, tidyName, zonesToGeoJson, type OsmPlace } from "./osm.ts";

// Real Overpass answer for Alvarado, Veracruz (October 2026), trimmed to the tags we read.
const alvarado = JSON.parse(readFileSync(new URL("./fixtures/overpass-alvarado.json", import.meta.url), "utf8"));

const point = (name: string, lon: number, lat: number, kind: OsmPlace["kind"] = "neighbourhood"): OsmPlace => ({
  osmId: `node/${name}`,
  name,
  kind,
  center: [lon, lat],
});

/** Shoelace area in squared degrees (enough to compare zones). */
const area = (ring: number[][]) =>
  Math.abs(ring.slice(0, -1).reduce((s, p, i) => s + p[0] * ring[i + 1][1] - ring[i + 1][0] * p[1], 0)) / 2;

describe("overpassQuery", () => {
  it("scopes the search to the municipality inside its state and escapes quotes", () => {
    const q = overpassQuery(' Alvarado"] ; out; ', "Veracruz (Ignacio)");
    assert.match(q, /\["admin_level"="6"\]\["name"="Alvarado\\"\] ; out;"\]/);
    assert.match(q, /\["name"~"Veracruz \\\\\(Ignacio\\\\\)"\]/);
    assert.match(q, /out geom;$/);
  });
});

describe("municipalityFromOrgName", () => {
  it("drops the ayuntamiento or municipio prefix", () => {
    assert.equal(municipalityFromOrgName("H. Ayuntamiento de Alvarado"), "Alvarado");
    assert.equal(municipalityFromOrgName("Municipio de San Andrés del Valle"), "San Andrés del Valle");
    assert.equal(municipalityFromOrgName("Alvarado"), "Alvarado");
  });
});

describe("tidyName", () => {
  it("title-cases names typed in capitals and leaves the rest alone", () => {
    assert.equal(tidyName("RESIDENCIAL LAS HIGUERAS"), "Residencial las Higueras");
    assert.equal(tidyName("LOMAS DE LA RIOJA"), "Lomas de la Rioja");
    assert.equal(tidyName("  Torres el   Sendero "), "Torres el Sendero");
  });
});

describe("parseOverpass", () => {
  it("reads the places of Alvarado and marks the seat", () => {
    const result = parseOverpass(alvarado);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.municipality, "Alvarado");
    assert.equal(result.places.length, 61);
    assert.equal(result.places[0].name, "Alvarado (cabecera)");
    const names = result.places.map((p) => p.name);
    assert.ok(names.includes("Antón Lizardo"));
    assert.ok(names.includes("Real Mandinga"));
    // Closed ways keep their outline.
    const issfam = result.places.find((p) => p.name === "ISSFAM Unidad Habitacional");
    assert.equal(issfam?.kind, "residential");
    assert.equal(issfam?.ring?.length, 18);
  });

  it("says when the municipality is not found", () => {
    const result = parseOverpass({ elements: [] });
    assert.equal(result.ok, false);
    assert.equal(parseOverpass({ remark: "runtime error" }).ok, false);
  });

  it("keeps one place per name, preferring the outline", () => {
    const ring = [{ lat: 19, lon: -96 }, { lat: 19, lon: -95.99 }, { lat: 19.01, lon: -95.99 }, { lat: 19, lon: -96 }];
    const result = parseOverpass({
      elements: [
        { type: "relation", id: 1, tags: { boundary: "administrative", admin_level: "6", name: "X" } },
        { type: "node", id: 2, lat: 19, lon: -96, tags: { place: "neighbourhood", name: "El Faro" } },
        { type: "way", id: 3, geometry: ring, tags: { landuse: "residential", name: "EL FARO" } },
        { type: "way", id: 4, geometry: ring.slice(0, 3), tags: { place: "hamlet", name: "Abierto" } },
        { type: "node", id: 5, lat: 19, lon: -96, tags: { place: "island", name: "Isla" } },
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.places.map((p) => [p.osmId, p.name]), [["way/3", "El Faro"]]);
  });
});

describe("approximateZones", () => {
  it("splits two close places along their bisector and caps lone ones", () => {
    // ~220 m apart: each zone is cut on the line between them.
    const [a, b] = approximateZones([point("A", -96, 19), point("B", -95.9979, 19)]);
    assert.ok(a.approx && b.approx);
    const maxLonA = Math.max(...a.geometry.coordinates[0].map((p) => (p as number[])[0]));
    const minLonB = Math.min(...b.geometry.coordinates[0].map((p) => (p as number[])[0]));
    assert.ok(Math.abs(maxLonA - -95.99895) < 1e-5, `A ends at ${maxLonA}`);
    assert.ok(Math.abs(minLonB - -95.99895) < 1e-5, `B starts at ${minLonB}`);

    // A lone hamlet gets its full circle; a village a bigger one.
    const [hamlet] = approximateZones([point("H", -96, 19, "hamlet")]);
    const [village] = approximateZones([point("V", -96, 19, "village")]);
    const ring = hamlet.geometry.coordinates[0] as number[][];
    assert.equal(ring.length, 33);
    assert.deepEqual(ring[0], ring[ring.length - 1]);
    assert.ok(area(village.geometry.coordinates[0] as number[][]) > 3 * area(ring));
  });

  it("produces valid polygons for every Alvarado place and round-trips through the catalog import", () => {
    const parsed = parseOverpass(alvarado);
    assert.ok(parsed.ok);
    const zones = approximateZones(parsed.places);
    assert.equal(zones.length, 61);
    assert.equal(zones.filter((z) => !z.approx).length, 5);
    const imported = parseNeighborhoodsGeoJson(zonesToGeoJson(zones));
    assert.equal(imported.ok, true);
    if (!imported.ok) return;
    assert.equal(imported.features.length, 61);
    assert.equal(imported.skipped.length, 0);
    assert.equal(imported.features.find((f) => f.name === "Antón Lizardo")?.approx, true);
    assert.equal(imported.features.find((f) => f.name === "Conejo")?.approx, false);
  });
});
