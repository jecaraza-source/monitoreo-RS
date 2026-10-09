import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONDITION_SCHEMAS,
  decideDigest,
  decideMediaNegative,
  decideRiskTerms,
  decideSentimentDrop,
  decideSpike,
  defaultRules,
  digestDue,
  parseChannels,
  parseCondition,
  splitList,
  type Candidate,
} from "./rules.ts";

const spike = CONDITION_SCHEMAS.spike.parse({});

describe("spike", () => {
  it("fires above mean + k·σ and the floor", () => {
    const d = decideSpike({ current: 50, mean: 0.6, stddev: 0.8 }, spike);
    assert.ok(d);
    assert.equal(d.fingerprint, "spike");
    assert.equal(d.severity, "critical");
    assert.match(d.title, /50 en 1 hora/);
  });

  it("stays quiet within normal variation or below the floor", () => {
    assert.equal(decideSpike({ current: 12, mean: 8, stddev: 2 }, spike), null);
    assert.equal(decideSpike({ current: 6, mean: 0.5, stddev: 0.5 }, spike), null);
  });

  it("treats a flat baseline as σ = 1", () => {
    assert.equal(decideSpike({ current: 10, mean: 8, stddev: 0 }, { ...spike, min_mentions: 1 }), null);
    assert.ok(decideSpike({ current: 12, mean: 8, stddev: 0 }, { ...spike, min_mentions: 1 }));
  });
});

describe("sentiment drop", () => {
  const c = CONDITION_SCHEMAS.sentiment_drop.parse({});
  it("fires when NSS falls enough with enough mentions", () => {
    const d = decideSentimentDrop({ currentClassified: 40, currentNss: -60, baselineClassified: 200, baselineNss: -10 }, c);
    assert.ok(d);
    assert.equal(d.severity, "critical");
    assert.equal(decideSentimentDrop({ currentClassified: 40, currentNss: -20, baselineClassified: 200, baselineNss: -10 }, c), null);
    assert.equal(decideSentimentDrop({ currentClassified: 3, currentNss: -100, baselineClassified: 200, baselineNss: 0 }, c), null);
  });
});

const candidate = (over: Partial<Candidate>): Candidate => ({
  mentionId: "m",
  text: "texto",
  sentiment: "negative",
  authorId: null,
  authorKind: "citizen",
  authorName: null,
  terms: [],
  maxSeverity: null,
  ...over,
});

describe("risk terms and media", () => {
  it("groups by term and respects the minimum severity", () => {
    const decisions = decideRiskTerms(
      [
        candidate({ mentionId: "1", terms: ["Balacera"], maxSeverity: "critical" }),
        candidate({ mentionId: "2", terms: ["Balacera"], maxSeverity: "critical" }),
        candidate({ mentionId: "3", terms: ["Manifestación"], maxSeverity: "medium" }),
      ],
      { window_minutes: 60, min_severity: "high" },
    );
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].fingerprint, "term:balacera");
    assert.deepEqual(decisions[0].mentionIds, ["1", "2"]);
    assert.equal(decisions[0].severity, "critical");
  });

  it("alerts once per outlet with negative mentions, never for citizens", () => {
    const decisions = decideMediaNegative([
      candidate({ mentionId: "1", authorId: "a", authorKind: "media", authorName: "Diario" }),
      candidate({ mentionId: "2", authorId: "a", authorKind: "media", authorName: "Diario" }),
      candidate({ mentionId: "3", authorId: "b", authorKind: "media", sentiment: "positive" }),
      candidate({ mentionId: "4", authorId: null, authorKind: "citizen" }),
    ]);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].fingerprint, "author:a");
    assert.match(decisions[0].title, /Diario \(medio\) publicó 2 menciones negativas/);
  });
});

describe("daily digest", () => {
  it("is due from the configured Mexico City hour, once per day", () => {
    // 14:30 UTC = 8:30 in Mexico City (UTC−6); 13:30 UTC = 7:30.
    assert.deepEqual(digestDue({ hour: 8 }, new Date("2026-10-09T14:30:00Z")), { due: true, day: "2026-10-09" });
    assert.equal(digestDue({ hour: 8 }, new Date("2026-10-09T13:30:00Z")).due, false);
    // 03:00 UTC on the 10th is still the 9th in Mexico City.
    assert.equal(digestDue({ hour: 8 }, new Date("2026-10-10T03:00:00Z")).day, "2026-10-09");
  });

  it("summarizes the numbers", () => {
    const d = decideDigest("2026-10-09", {
      mentions: 15, positive: 4, neutral: 1, negative: 9, complaints: 9, open_tickets: 62,
      top_topics: [{ topic: "drenaje", mentions: 2 }],
      top_neighborhoods: [{ name: "Centro", complaints: 2 }],
    });
    assert.equal(d.fingerprint, "digest:2026-10-09");
    assert.match(d.title, /15 menciones, NSS -36/);
    assert.match(d.summary, /Temas: drenaje \(2\)\. Colonias con más quejas: Centro \(2\)\./);
  });
});

describe("parsing", () => {
  it("fills defaults and rejects out-of-range values", () => {
    assert.deepEqual(parseCondition("spike", {}), { window_minutes: 60, baseline_days: 14, k: 3, min_mentions: 10 });
    assert.equal(parseCondition("spike", { k: 50 }), null);
    assert.deepEqual(parseChannels({ email: ["a@b.mx"] }), { email: ["a@b.mx"], whatsapp: [] });
    assert.deepEqual(splitList("a@b.mx, c@d.mx\n a@b.mx"), ["a@b.mx", "c@d.mx"]);
    assert.equal(defaultRules().length, 5);
  });
});
