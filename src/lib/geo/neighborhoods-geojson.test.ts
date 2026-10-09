import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseNeighborhoodsGeoJson } from "./neighborhoods-geojson.ts";

const square = [[[-99.1, 19.4], [-99.09, 19.4], [-99.09, 19.41], [-99.1, 19.41], [-99.1, 19.4]]];
const feature = (properties: Record<string, unknown>, geometry: unknown = { type: "Polygon", coordinates: square }) => ({
  type: "Feature",
  properties,
  geometry,
});
const collection = (...features: unknown[]) => ({ type: "FeatureCollection", features });

describe("parseNeighborhoodsGeoJson", () => {
  it("reads polygons and guesses the name property", () => {
    const result = parseNeighborhoodsGeoJson(
      collection(feature({ NOMBRE: "Centro", cve: "01" }), feature({ NOMBRE: "Las Flores", cve: "02" }, {
        type: "MultiPolygon",
        coordinates: [square],
      })),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.nameProperty, "NOMBRE");
    assert.deepEqual(result.features.map((f) => f.name), ["Centro", "Las Flores"]);
    assert.equal(result.features[1].geometry.type, "MultiPolygon");
    assert.deepEqual(result.candidateProperties.sort(), ["NOMBRE", "cve"]);
  });

  it("uses the property the user picks", () => {
    const result = parseNeighborhoodsGeoJson(collection(feature({ name: "x", alias: "Centro Histórico" })), "alias");
    assert.equal(result.ok && result.features[0].name, "Centro Histórico");
  });

  it("skips invalid, unnamed and duplicated features", () => {
    const result = parseNeighborhoodsGeoJson(
      collection(
        feature({ name: "Centro" }),
        feature({ name: "CÉNTRO" }),
        feature({ name: "" }),
        feature({ name: "Punto" }, { type: "Point", coordinates: [-99, 19] }),
        feature({ name: "Roto" }, { type: "Polygon", coordinates: [[[0, 0], [1, 1]]] }),
      ),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.features.map((f) => f.name), ["Centro"]);
    assert.deepEqual(result.skipped.map((s) => s.index), [1, 2, 3, 4]);
  });

  it("rejects files that are not usable", () => {
    assert.equal(parseNeighborhoodsGeoJson({ type: "Feature" }).ok, false);
    assert.equal(parseNeighborhoodsGeoJson(collection()).ok, false);
    assert.equal(parseNeighborhoodsGeoJson(collection(feature({ area: 3 }))).ok, false);
    assert.equal(parseNeighborhoodsGeoJson(null).ok, false);
  });
});
