import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAliases, parseOfficials, totals } from "./model.ts";

describe("officials model", () => {
  const raw = {
    officials: [
      {
        id: "a", name: "Ana Lucía Torres", position: "Presidenta municipal",
        mentions: 10, positive: 2, neutral: 3, negative: 5, interactions: 120,
        prev_mentions: 4, prev_positive: 2, prev_negative: 1,
        daily: [{ day: "2026-10-10", positive: 1, neutral: 0, negative: 2 }],
        topics: [{ topic: "gestión del gobierno", mentions: 6, negative: 4 }],
        emotions: [{ emotion: "enojo", mentions: 3 }],
      },
      { id: "b", name: "Raúl Méndez", position: "Director", mentions: 0, positive: 0, neutral: 0, negative: 0, interactions: 0,
        prev_mentions: 0, prev_positive: 0, prev_negative: 0, daily: [], topics: [], emotions: [] },
    ],
  };

  it("derives NSS, negative share and the previous period", () => {
    const [ana, raul] = parseOfficials(raw);
    assert.equal(ana.nss, -30);
    assert.equal(ana.negativePct, 50);
    assert.deepEqual(ana.previous, { mentions: 4, positive: 2, negative: 1, nss: 25, negativePct: 25 });
    assert.equal(ana.daily[0].negative, 2);
    assert.equal(raul.nss, 0);
    assert.equal(raul.negativePct, 0);
    assert.deepEqual(parseOfficials(null), []);
  });

  it("adds up the module totals", () => {
    const t = totals(parseOfficials(raw));
    assert.equal(t.mentions, 10);
    assert.equal(t.negativePct, 50);
    assert.equal(t.nss, -30);
    assert.equal(t.previous.mentions, 4);
    assert.equal(t.previous.nss, 25);
  });

  it("cleans the aliases typed in the catalog", () => {
    assert.deepEqual(parseAliases("la alcaldesa, @AnaTorres\n Alcaldesa ,  presidenta   municipal, ab"), [
      "la alcaldesa",
      "AnaTorres",
      "Alcaldesa",
      "presidenta municipal",
    ]);
  });
});
