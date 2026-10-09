import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeDelta, computePointDelta, formatDelta, formatPoints, trendTone } from "./metrics.ts";

describe("computeDelta", () => {
  it("computes the relative change", () => {
    assert.deepEqual(computeDelta(120, 100), { ratio: 0.2, trend: "up" });
    assert.deepEqual(computeDelta(75, 100), { ratio: -0.25, trend: "down" });
  });

  it("treats tiny changes as flat", () => {
    assert.deepEqual(computeDelta(1000.4, 1000), { ratio: 0, trend: "flat" });
  });

  it("has no ratio without a usable baseline", () => {
    assert.deepEqual(computeDelta(10, undefined), { ratio: null, trend: "flat" });
    assert.deepEqual(computeDelta(10, 0), { ratio: null, trend: "up" });
    assert.deepEqual(computeDelta(0, 0), { ratio: null, trend: "flat" });
  });
});

describe("trendTone", () => {
  it("is green when the metric moves the good way", () => {
    assert.equal(trendTone("up"), "positive");
    assert.equal(trendTone("down"), "negative");
    assert.equal(trendTone("up", false), "negative");
    assert.equal(trendTone("down", false), "positive");
    assert.equal(trendTone("flat", false), "neutral");
  });
});

describe("formatDelta", () => {
  it("formats with sign in es-MX", () => {
    assert.match(formatDelta({ ratio: 0.125, trend: "up" }), /^\+12\.5\s?%$/);
    assert.match(formatDelta({ ratio: -0.03, trend: "down" }), /^-3\s?%$/);
    assert.equal(formatDelta({ ratio: null, trend: "flat" }), "—");
  });
});

describe("point deltas", () => {
  it("reports the difference in points", () => {
    assert.deepEqual(computePointDelta(12, 10), { ratio: null, points: 2, trend: "up" });
    assert.equal(computePointDelta(-5, 3).trend, "down");
    assert.equal(computePointDelta(10, 10.01).trend, "flat");
    assert.equal(computePointDelta(10, null).points, null);
    assert.equal(formatPoints(2.46), "+2.5 pts");
    assert.equal(formatPoints(null), "—");
  });

  it("keeps neutral metrics gray", () => {
    assert.equal(trendTone("up", null), "neutral");
  });
});
