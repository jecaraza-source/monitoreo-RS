import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildExpression, formatTerm, groupAtoms } from "./builder.ts";
import { matches } from "./match.ts";

const build = (groups: Parameters<typeof buildExpression>[0]["groups"]) => {
  const result = buildExpression({ groups });
  assert.equal(result.ok, true, JSON.stringify(result));
  return (result as { expression: string }).expression;
};

describe("formatTerm", () => {
  it("quotes phrases and keeps wildcards", () => {
    assert.equal(formatTerm("bache"), "bache");
    assert.equal(formatTerm("  presidente   municipal "), '"presidente municipal"');
    assert.equal(formatTerm("educa*"), "educa*");
    assert.equal(formatTerm('San "Andrés" (centro)'), '"San Andrés centro"');
    assert.equal(formatTerm("#SanAndrés"), '"#SanAndrés"');
  });

  it("quotes operator words so they are searched literally", () => {
    assert.equal(formatTerm("OR"), '"OR"');
  });

  it("drops terms with nothing searchable", () => {
    assert.equal(formatTerm("   "), null);
    assert.equal(formatTerm("*"), null);
    assert.equal(formatTerm('""'), null);
  });
});

describe("groupAtoms", () => {
  it("dedupes ignoring case and accents", () => {
    assert.deepEqual(groupAtoms({ mode: "any", terms: ["Atención", "atencion", "ATENCIÓN", "queja"] }), [
      "Atención",
      "queja",
    ]);
  });
});

describe("buildExpression", () => {
  it("combines any / all / none groups", () => {
    assert.equal(
      build([
        { mode: "any", terms: ["San Andrés", "#SanAndrés"] },
        { mode: "all", terms: ["agua", "fuga"] },
        { mode: "none", terms: ["pipa*", "San Andrés Tuxtla"] },
      ]),
      '("San Andrés" OR "#SanAndrés") AND (agua AND fuga) AND NOT (pipa* OR "San Andrés Tuxtla")',
    );
  });

  it("omits parentheses for single terms and skips empty groups", () => {
    assert.equal(
      build([
        { mode: "any", terms: ["bache"] },
        { mode: "all", terms: [] },
        { mode: "none", terms: ["coche"] },
      ]),
      "bache AND NOT coche",
    );
  });

  it("puts exclusions last regardless of group order", () => {
    assert.equal(build([{ mode: "none", terms: ["spam"] }, { mode: "any", terms: ["luz"] }]), "luz AND NOT spam");
  });

  it("requires something to include", () => {
    assert.deepEqual(buildExpression({ groups: [{ mode: "none", terms: ["x"] }] }), {
      ok: false,
      message: "Agrega al menos un grupo de términos a incluir.",
    });
    assert.equal(buildExpression({ groups: [] }).ok, false);
  });

  it("generates expressions that match.ts evaluates as intended", () => {
    const expression = build([
      { mode: "any", terms: ["San Andrés", "SanAndres"] },
      { mode: "any", terms: ["agua", "fuga*", "drenaje"] },
      { mode: "none", terms: ["San Andrés Tuxtla", "pipa*"] },
    ]);
    assert.equal(matches(expression, "Hay fugas en el centro de SAN ANDRES"), true);
    assert.equal(matches(expression, "#SanAndrés sin agua otra vez"), true);
    assert.equal(matches(expression, "San Andrés Tuxtla sin agua"), false);
    assert.equal(matches(expression, "En San Andrés la pipa de agua no llegó"), false);
    assert.equal(matches(expression, "San Andrés: feria del pan"), false);
  });
});
