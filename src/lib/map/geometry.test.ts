import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pointInGeometry, quantize, validateGeometry, type Geometry } from "./geometry.ts";

const square = [[-99.13, 19.39], [-99.12, 19.39], [-99.12, 19.4], [-99.13, 19.4], [-99.13, 19.39]];

describe("colonia geometries", () => {
  it("accepts polygons and features", () => {
    assert.equal(validateGeometry({ type: "Polygon", coordinates: [square] }).ok, true);
    assert.equal(validateGeometry({ type: "Feature", geometry: { type: "MultiPolygon", coordinates: [[square]] } }).ok, true);
  });

  it("explains what is wrong", () => {
    const reason = (g: unknown) => {
      const r = validateGeometry(g);
      return r.ok ? null : r.reason;
    };
    assert.equal(reason(null), "missing");
    assert.equal(reason({ type: "Point", coordinates: [-99, 19] }), "type");
    assert.equal(reason({ type: "Polygon", coordinates: [[["a", 1]]] }), "coordinates");
    assert.equal(reason({ type: "Polygon", coordinates: [square.slice(0, 4)] }), "ring", "not closed");
    assert.equal(reason({ type: "Polygon", coordinates: [[[0, 0], [1, 1], [0, 0]]] }), "ring", "too few points");
    assert.equal(reason({ type: "Polygon", coordinates: [square.map(([x, y]) => [y, x * -2])] }), "range", "swapped and out of range");
    const huge = Array.from({ length: 20_001 }, (_, i) => [-99 + i * 1e-6, 19]);
    huge.push(huge[0]);
    assert.equal(reason({ type: "Polygon", coordinates: [huge] }), "size");
  });

  it("finds points inside, outside and in holes", () => {
    const g = { type: "Polygon", coordinates: [square] } as Geometry;
    assert.equal(pointInGeometry(g, -99.125, 19.395), true);
    assert.equal(pointInGeometry(g, -99.115, 19.395), false);
    const holed = { type: "MultiPolygon", coordinates: [[[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]]] } as Geometry;
    assert.equal(pointInGeometry(holed, 2, 2), false);
    assert.equal(pointInGeometry(holed, 0.5, 0.5), true);
  });
});

describe("quantize", () => {
  it("rounds every coordinate to about a meter", () => {
    const g = { type: "Polygon", coordinates: [[[-99.1234567, 19.7654321], [-99.1, 19.7], [-99.2, 19.8], [-99.1234567, 19.7654321]]] } as Geometry;
    assert.deepEqual(quantize(g).coordinates[0][0], [-99.12346, 19.76543]);
  });
});
