import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { placeTerm, TOPIC_TEMPLATES } from "./templates.ts";
import { buildExpression } from "./builder.ts";
import { validateQuery } from "./match.ts";
import { toXSearch, tweetScraperInput } from "./x-search.ts";

describe("toXSearch", () => {
  it("turns the query language into X search syntax", () => {
    assert.deepEqual(toXSearch('(Alvarado OR "H. Ayuntamiento de Alvarado") AND ("sin agua" OR drenaje) AND NOT (pipa OR garrafón)'), {
      search: '(Alvarado OR "H. Ayuntamiento de Alvarado") ("sin agua" OR drenaje) -pipa -garrafón',
      approximate: false,
    });
    assert.equal(toXSearch("agua NOT (pipa AND gratis)").search, "agua -(pipa gratis)");
  });

  it("drops wildcards and says the search is approximate", () => {
    assert.deepEqual(toXSearch("Alvarado bache*"), { search: "Alvarado bache", approximate: true });
  });

  it("builds the tweet scraper input", () => {
    assert.deepEqual(tweetScraperInput(["a b"]), { searchTerms: ["a b"], sort: "Latest", tweetLanguage: "es", maxItems: 200 });
  });
});

describe("topic templates", () => {
  it("are valid queries once combined with the place", () => {
    for (const t of TOPIC_TEMPLATES) {
      const built = buildExpression({ groups: [{ mode: "any", terms: ["Alvarado"] }, { mode: "any", terms: t.terms }] });
      assert.ok(built.ok && validateQuery(built.expression).ok, t.key);
    }
  });

  it("takes the place from the municipality's name", () => {
    assert.equal(placeTerm("Municipio de San Andrés del Valle"), "San Andrés del Valle");
    assert.equal(placeTerm("H. Ayuntamiento de Alvarado"), "Alvarado");
    assert.equal(placeTerm("Alvarado"), "Alvarado");
  });
});
