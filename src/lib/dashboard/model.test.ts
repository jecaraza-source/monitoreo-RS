import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { byNss, findPeaks, inboxHref, negativeShare, nss, parseDashboard } from "./model.ts";
import { parsePeriod, periodSearch } from "./period.ts";

describe("parsePeriod", () => {
  const now = new Date("2026-10-09T18:20:00Z");

  it("defaults to 7 days ending at the next full hour, with the previous 7 days", () => {
    const p = parsePeriod({}, now);
    assert.equal(p.key, "7d");
    assert.equal(p.to.toISOString(), "2026-10-09T19:00:00.000Z");
    assert.equal(p.from.toISOString(), "2026-10-02T19:00:00.000Z");
    assert.equal(p.prevFrom.toISOString(), "2026-09-25T19:00:00.000Z");
    assert.equal(p.prevTo.toISOString(), p.from.toISOString());
    assert.equal(p.bucket, "day");
  });

  it("uses hourly buckets for 24 h", () => {
    const p = parsePeriod({ periodo: "24h" }, now);
    assert.equal(p.bucket, "hour");
    assert.equal(p.to.getTime() - p.from.getTime(), 86_400_000);
  });

  it("reads custom Mexico City days and falls back when they are invalid", () => {
    const p = parsePeriod({ periodo: "custom", desde: "2026-10-01", hasta: "2026-10-03" }, now);
    assert.equal(p.key, "custom");
    assert.equal(p.from.toISOString(), "2026-10-01T06:00:00.000Z");
    assert.equal(p.to.toISOString(), "2026-10-04T06:00:00.000Z");
    assert.equal(p.fromDay, "2026-10-01");
    assert.equal(p.toDay, "2026-10-03");
    assert.equal(parsePeriod({ periodo: "custom", desde: "2026-10-05", hasta: "2026-10-01" }, now).key, "7d");
    assert.equal(parsePeriod({ periodo: "1y" }, now).key, "7d");
  });

  it("builds the query string", () => {
    assert.equal(periodSearch("30d"), "?periodo=30d");
    assert.equal(periodSearch("custom", "2026-10-01", "2026-10-03"), "?periodo=custom&desde=2026-10-01&hasta=2026-10-03");
  });
});

describe("metrics", () => {
  it("computes NSS and negative share", () => {
    assert.equal(nss(30, 10, 50), 40);
    assert.equal(nss(0, 0, 0), 0);
    assert.equal(negativeShare({ negative: 25, classified: 100 }), 25);
  });

  it("keeps the busiest rows and sorts them worst first", () => {
    const rows = [
      { id: "a", total: 50, nss: 10 },
      { id: "b", total: 40, nss: -30 },
      { id: "c", total: 2, nss: -90 },
    ];
    assert.deepEqual(byNss(rows, 2).map((r) => r.id), ["b", "a"]);
  });

  it("finds separated peaks above the typical bucket", () => {
    const point = (total: number) => ({ bucket: "", positive: 0, neutral: 0, negative: total, pending: 0 });
    const series = [5, 6, 30, 28, 5, 4, 20, 5].map(point);
    assert.deepEqual(findPeaks(series), [2, 6]);
    assert.deepEqual(findPeaks([5, 5, 6, 5].map(point)), []);
  });

  it("links to the inbox with the period", () => {
    assert.equal(
      inboxHref({ fromDay: "2026-10-01", toDay: "2026-10-07" }, { topic: "drenaje" }),
      "/bandeja?from=2026-10-01&to=2026-10-07&topic=drenaje&status=all",
    );
  });

  it("parses the payload, coercing nulls and naming departments", () => {
    const data = parseDashboard(
      {
        totals: { mentions: 10, classified: 8, positive: 4, negative: 2, attention_hours: null },
        departments: [{ id: "d1", total: 6, positive: null, negative: 3 }],
        top_mentions: [{ id: "m", text: "x", source_id: "s1", interactions: "12", handle: "vecino" }],
      },
      { totals: { mentions: 5 } },
      new Map([["d1", "Obras"]]),
      new Map([["s1", "RSS · Diario"]]),
    );
    assert.equal(data.totals.attentionHours, null);
    assert.equal(data.previous.mentions, 5);
    assert.deepEqual(data.departments[0], { id: "d1", name: "Obras", total: 6, positive: 0, negative: 3, nss: -50 });
    assert.equal(data.topMentions[0].source, "RSS · Diario");
    assert.equal(data.topMentions[0].author, "@vecino");
    assert.equal(data.topMentions[0].interactions, 12);
    assert.deepEqual(data.series, []);
  });
});
