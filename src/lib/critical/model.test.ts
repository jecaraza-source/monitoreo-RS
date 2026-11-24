import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { change, isRising, nameWords, parseCriticalVoices, termWords, topTerms } from "./model.ts";

describe("rising topics", () => {
  it("needs enough mentions and real growth", () => {
    assert.equal(isRising(4, 0), false, "too few to call it a trend");
    assert.equal(isRising(5, 0), true, "new and big enough");
    assert.equal(isRising(9, 6), true, "+50 %");
    assert.equal(isRising(8, 6), false, "+33 %");
    assert.equal(change(3, 0), null);
    assert.equal(change(15, 10), 0.5);
  });
});

describe("frequent terms", () => {
  it("never surfaces @handles or links, and drops stopwords and the municipality's name", () => {
    const words = termWords("@JuanPerez_99 otra vez sin agua en Alvarado https://t.co/abc #SinAgua", nameWords("Alvarado"));
    assert.deepEqual(words, ["agua", "sinagua"]);
    assert.deepEqual(termWords("escríbanle a juan.perez@mail.mx por los baches"), ["escribanle", "baches"], "emails are dropped too");
  });

  it("prefers repeated phrases and counts each text once", () => {
    const terms = topTerms([
      "Fuga de agua en la colonia Centro, fuga de agua otra vez",
      "Otra fuga de agua en colonia Centro",
      "Baches por todos lados",
      "Los baches no los tapan",
    ]);
    assert.deepEqual(terms.slice(0, 3), [
      { term: "baches", count: 2 },
      { term: "colonia centro", count: 2 },
      { term: "fuga de agua", count: 2 },
    ]);
    assert.ok(!terms.some((t) => t.term === "fuga"), "words already counted in a phrase do not repeat alone");
    assert.deepEqual(topTerms(["La señora del camión", "Otra senora en el camion", "la señora"]).map((t) => t.term), ["señora", "camión"], "shown as most people write them");
  });
});

describe("parseCriticalVoices", () => {
  it("reads the RPC answer with growth flags and no authors", () => {
    const data = parseCriticalVoices({
      totals: { negative: 12, classified: 40, prev_negative: 6, prev_classified: 30 },
      series: [{ bucket: "2026-11-20T06:00:00+00:00", negative: 3, classified: 9 }],
      topics: [{ topic: "agua", negative: 8, prev_negative: 2, classified: 10 }, { topic: "baches", negative: 4, prev_negative: 4, classified: 8 }],
      neighborhoods: [{ id: "n1", name: "Centro", negative: 6, prev_negative: 0 }],
      departments: [],
      platforms: [{ type: "apify", negative: 5 }],
      emotions: [{ emotion: "enojo", negative: 7 }],
      top: [{ id: "m1", text: "Sin agua", url: null, published_at: "2026-11-20T10:00:00Z", topic: "agua", source_type: "rss", neighborhood: "Centro", interactions: "9" }],
      texts: ["sin agua otra vez", "sin agua en Centro", 3],
    });
    assert.deepEqual(data.totals, { negative: 12, classified: 40, prevNegative: 6, prevClassified: 30 });
    assert.deepEqual(data.topics.map((t) => [t.topic, t.rising]), [["agua", true], ["baches", false]]);
    assert.equal(data.neighborhoods[0].rising, true);
    assert.equal(data.top[0].interactions, 9);
    assert.deepEqual(data.terms[0], { term: "agua", count: 2 });
    assert.ok(!JSON.stringify(data).includes("author"));
  });
});
