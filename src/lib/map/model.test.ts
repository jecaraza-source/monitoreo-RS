import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMapStats, mapCsv, mapHref, METRICS, parseMapFilters, rankRows, scaleMax, type MapRow } from "./model.ts";

const ID = "00000000-0000-4000-c000-000000000001";
const ID2 = "00000000-0000-4000-c000-000000000002";

const row = (over: Partial<MapRow>): MapRow => ({
  id: ID,
  name: "Centro",
  approx: false,
  total: 0,
  complaints: 0,
  positive: 0,
  neutral: 0,
  negative: 0,
  prevTotal: 0,
  prevComplaints: 0,
  prevClassified: 0,
  prevPositive: 0,
  prevNegative: 0,
  topics: [],
  ...over,
});

describe("parseMapFilters", () => {
  it("keeps valid filters and drops malformed ones", () => {
    assert.deepEqual(parseMapFilters({ tema: "drenaje", dependencia: "x", sentimiento: "negative", colonia: ID, metrica: "nss" }), {
      tema: "drenaje",
      dependencia: undefined,
      sentimiento: "negative",
      colonia: ID,
      metrica: "nss",
    });
    assert.equal(parseMapFilters(new URLSearchParams("metrica=otra")).metrica, "quejas");
  });
});

describe("mapHref", () => {
  it("keeps the period and other filters, removes with null and omits the default metric", () => {
    const current = new URLSearchParams(`periodo=30d&tema=drenaje&metrica=nss&colonia=${ID}&otro=1`);
    assert.equal(mapHref(current, { colonia: null }), "/mapa?periodo=30d&tema=drenaje&metrica=nss");
    assert.equal(mapHref(current, { metrica: "quejas", tema: null, colonia: null }), "/mapa?periodo=30d");
    assert.equal(mapHref(new URLSearchParams(), {}), "/mapa");
  });
});

describe("buildMapStats", () => {
  it("gives every colonia of the catalog a row, with zeros when it had no mentions", () => {
    const stats = buildMapStats(
      {
        neighborhoods: [{ id: ID, total: "12", complaints: 5, positive: 2, neutral: 3, negative: 7, prev_complaints: 2, topics: [{ topic: "agua", total: 4 }] }],
        unassigned: 3,
        total: 15,
        topics: ["agua", "drenaje"],
      },
      [
        { id: ID, name: "Centro", approx: false },
        { id: ID2, name: "Antón Lizardo", approx: true },
      ],
    );
    assert.equal(stats.rows[0].total, 12);
    assert.deepEqual(stats.rows[0].topics, [{ topic: "agua", total: 4 }]);
    assert.equal(stats.rows[1].total, 0);
    assert.equal(stats.rows[1].approx, true);
    assert.equal(stats.unassigned, 3);
    assert.deepEqual(stats.topics, ["agua", "drenaje"]);
    assert.deepEqual(buildMapStats(null, []).rows, []);
  });
});

describe("metrics", () => {
  it("hides rates for colonias with too few classified mentions", () => {
    assert.equal(METRICS.negativo.value(row({ total: 2, negative: 2 })), null);
    assert.equal(METRICS.negativo.value(row({ total: 4, negative: 1, neutral: 3 })), 25);
    assert.equal(METRICS.nss.value(row({ total: 4, positive: 3, negative: 1 })), 50);
    assert.equal(METRICS.cambio.value(row({ complaints: 2, prevComplaints: 5 })), -3);
  });

  it("scales counts to the largest value and rates to 100", () => {
    const rows = [row({ complaints: 4, prevComplaints: 10 }), row({ complaints: 9 })];
    assert.equal(scaleMax(rows, "quejas"), 9);
    assert.equal(scaleMax(rows, "cambio"), 9);
    assert.equal(scaleMax([], "menciones"), 1);
    assert.equal(scaleMax(rows, "nss"), 100);
  });

  it("ranks the worst colonias first", () => {
    const a = row({ id: "a", name: "A", total: 10, complaints: 6, positive: 1, negative: 8, neutral: 1 });
    const b = row({ id: "b", name: "B", total: 10, complaints: 2, positive: 7, negative: 1, neutral: 2 });
    const quiet = row({ id: "c", name: "C" });
    assert.deepEqual(rankRows([b, quiet, a], "quejas").map((r) => r.id), ["a", "b"]);
    assert.deepEqual(rankRows([a, b], "nss").map((r) => r.id), ["a", "b"]);
  });
});

describe("mapCsv", () => {
  it("writes one line per colonia with a BOM and neutralizes formulas", () => {
    const csv = mapCsv([row({ name: "=HYPERLINK(1)", total: 5, complaints: 2, negative: 5, approx: true, topics: [{ topic: "agua", total: 2 }] })]);
    assert.ok(csv.startsWith("﻿Colonia,Menciones"));
    const line = csv.trim().split("\n")[1];
    assert.ok(line.startsWith("'=HYPERLINK(1),5,2,0,0,5,100,-100,0,2,agua,aproximado"), line);
  });
});
