import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeNext } from "./redirect.ts";

describe("safeNext", () => {
  it("keeps in-app paths", () => {
    assert.equal(safeNext("/bandeja?estado=abierto"), "/bandeja?estado=abierto");
  });

  it("rejects anything that could leave the app", () => {
    for (const bad of ["https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)", "", null]) {
      assert.equal(safeNext(bad), "/", String(bad));
    }
  });
});
