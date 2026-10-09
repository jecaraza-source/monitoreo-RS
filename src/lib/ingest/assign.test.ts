import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NormalizedMention } from "../connectors/types.ts";
import { assignQueries, compileQueries, inBackoff, sinceFor } from "./assign.ts";

const mention = (externalId: string, text: string): NormalizedMention => ({
  externalId,
  text,
  url: null,
  publishedAt: "2026-10-09T10:00:00Z",
  kind: "article",
  author: null,
  metrics: {},
});

const { compiled, invalid } = compileQueries([
  { id: "q-municipio", expression: '"san andres" AND NOT "san andres tuxtla"' },
  { id: "q-broken", expression: "(agua" },
  { id: "q-servicios", expression: "agua OR bache*" },
]);

describe("assignQueries", () => {
  it("skips invalid queries and keeps priority order", () => {
    assert.deepEqual(invalid, ["q-broken"]);
    const { kept } = assignQueries([mention("1", "Baches y falta de agua en San Andrés")], compiled, true);
    assert.equal(kept[0].queryId, "q-municipio");
  });

  it("drops unmatched items when the source requires a match", () => {
    const items = [
      mention("1", "Fuga de agua en Centro"),
      mention("2", "Feria del tabaco en San Andrés Tuxtla"),
      mention("3", "Resultados de la liga"),
    ];
    const { kept, unmatched } = assignQueries(items, compiled, true);
    assert.deepEqual(kept.map((k) => [k.externalId, k.queryId]), [["1", "q-servicios"]]);
    assert.equal(unmatched, 2);
  });

  it("keeps unmatched items with a null query when not required", () => {
    const { kept, unmatched } = assignQueries([mention("3", "Gracias por la atención")], compiled, false);
    assert.equal(kept[0].queryId, null);
    assert.equal(unmatched, 0);
  });

  it("dedupes repeated items within one fetch", () => {
    const { kept } = assignQueries([mention("1", "agua"), mention("1", "agua")], compiled, true);
    assert.equal(kept.length, 1);
  });
});

describe("sinceFor / inBackoff", () => {
  const now = new Date("2026-10-09T15:00:00Z");

  it("starts from the last success minus 15 min, or a 3-day backfill", () => {
    assert.equal(sinceFor("2026-10-09T14:00:00Z", now).toISOString(), "2026-10-09T13:45:00.000Z");
    assert.equal(sinceFor(null, now).toISOString(), "2026-10-06T14:45:00.000Z");
  });

  it("backs off after three consecutive failures", () => {
    assert.equal(inBackoff(2, "2026-10-09T14:59:00Z", now), false);
    assert.equal(inBackoff(3, "2026-10-09T14:30:00Z", now), true); // waits 1 h
    assert.equal(inBackoff(3, "2026-10-09T13:30:00Z", now), false);
    assert.equal(inBackoff(10, "2026-10-08T16:00:00Z", now), true); // capped at 24 h
  });
});
