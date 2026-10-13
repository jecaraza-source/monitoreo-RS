import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorBadge, authorName, UNVERIFIED_AUTHOR } from "./label.ts";

describe("authorName", () => {
  it("names verified media and public figures", () => {
    assert.equal(authorName({ display_name: "Diario del Valle", handle: "diario-del-valle", kind: "media" }), "Diario del Valle");
    assert.equal(authorName({ display_name: null, handle: "regidora", kind: "public_figure" }), "@regidora");
    assert.equal(authorBadge({ display_name: null, handle: "regidora", kind: "public_figure" }), "Figura pública");
  });

  it("never shows the pseudonym or any identity of an unverified account", () => {
    const citizen = { display_name: "Nombre real", handle: "nv_0123456789abcdef01234567", kind: "citizen" as const };
    assert.equal(authorName(citizen), UNVERIFIED_AUTHOR);
    assert.equal(authorBadge(citizen), null);
    assert.equal(authorName(null), "Autor desconocido");
  });
});
