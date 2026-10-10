import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { centerOf, distanceKm, focusShapes } from "./focus.ts";

const square = (lon: number, lat: number, d = 0.005) => ({
  coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]],
});
const shape = (id: string, lon: number, lat: number, value: number | null) => ({ id, value, geometry: square(lon, lat) });

describe("focusShapes", () => {
  it("opens on the colonia with most of the metric and its neighbors, not the whole municipality", () => {
    const shapes = [
      shape("cabecera", -95.76, 18.77, 20),
      shape("vecina", -95.749, 18.768, 3),
      shape("sin-datos-cerca", -95.75, 18.78, 0),
      shape("riviera", -96.07, 19.06, 9), // ~45 km away
    ];
    assert.deepEqual(focusShapes(shapes).map((s) => s.id), ["cabecera", "vecina", "sin-datos-cerca"]);
  });

  it("uses the largest absolute value (worst NSS) and falls back to everything without data", () => {
    const shapes = [shape("a", -95.76, 18.77, 10), shape("b", -96.07, 19.06, -60)];
    assert.deepEqual(focusShapes(shapes).map((s) => s.id), ["b"]);
    const quiet = [shape("a", -95.76, 18.77, 0), shape("b", -96.07, 19.06, null)];
    assert.equal(focusShapes(quiet).length, 2);
  });

  it("measures centers and distances", () => {
    const [lon, lat] = centerOf(square(-96, 19, 0.01))!;
    assert.ok(Math.abs(lon - -95.995) < 1e-9 && Math.abs(lat - 19.005) < 1e-9);
    assert.equal(centerOf({ coordinates: [] }), null);
    assert.ok(Math.abs(distanceKm([-95.76, 18.77], [-96.07, 19.06]) - 45) < 2);
  });
});
