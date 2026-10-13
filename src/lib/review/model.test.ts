import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reviewOrder } from "./model.ts";

describe("review order", () => {
  it("puts emergencies first, then high risk, then the oldest", () => {
    const items = [
      { id: "a", reasons: ["low_confidence"], created_at: "2026-10-01T00:00:00Z" },
      { id: "b", reasons: ["high_risk"], created_at: "2026-10-03T00:00:00Z" },
      { id: "c", reasons: ["low_confidence", "emergency"], created_at: "2026-10-04T00:00:00Z" },
      { id: "d", reasons: ["high_risk"], created_at: "2026-10-02T00:00:00Z" },
    ];
    assert.deepEqual([...items].sort(reviewOrder).map((i) => i.id), ["c", "d", "b", "a"]);
  });
});
