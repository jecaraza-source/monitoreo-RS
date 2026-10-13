import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCaseLayer, caseRowFilters, casesHref, type CaseMapRow } from "./cases.ts";
import { parseMapFilters } from "./model.ts";

const row = (o: Partial<CaseMapRow>): CaseMapRow => ({
  id: "x",
  folio: "C-00001",
  status: "assigned",
  priority: "high",
  category: "agua potable",
  neighborhood_id: "a",
  department_id: null,
  location_status: "inferred",
  location_confidence: 0.7,
  lat: null,
  lng: null,
  overdue: false,
  opened_at: "2026-10-01T12:00:00Z",
  ...o,
});
const colonias = [
  { id: "a", name: "Centro", approx: false, drawable: true, problem: null },
  { id: "b", name: "Sin trazo", approx: false, drawable: false, problem: "Sin polígono" },
];

describe("cases layer", () => {
  it("counts per colonia, keeps zeros and explains what is not drawn", () => {
    const layer = buildCaseLayer(
      [
        row({ id: "1", overdue: true }),
        row({ id: "2", location_status: "confirmed", lat: 19.395, lng: -99.125, priority: "critical" }),
        row({ id: "3", neighborhood_id: "b" }),
        row({ id: "4", neighborhood_id: null, location_status: "unavailable" }),
      ],
      [...colonias, { id: "c", name: "Vacía", approx: false, drawable: true, problem: null }],
    );
    const a = layer.rows.find((r) => r.id === "a")!;
    assert.deepEqual([a.total, a.overdue, a.confirmed, a.inferred, a.byPriority.critical], [2, 1, 1, 1, 1]);
    assert.equal(layer.rows.find((r) => r.id === "c")!.total, 0, "a colonia with no cases is listed with zero");
    assert.deepEqual([layer.total, layer.located, layer.unlocated.length, layer.undrawn], [4, 3, 1, 1]);
  });

  it("only confirmed locations become points; an inferred colonia never does", () => {
    const layer = buildCaseLayer(
      [row({ id: "1", lat: 19.39, lng: -99.12 }), row({ id: "2", location_status: "confirmed", lat: 19.395, lng: -99.125 })],
      colonias,
    );
    assert.deepEqual(layer.points.map((p) => p.id), ["2"]);
  });

  it("links to /casos with the same filters", () => {
    const filters = parseMapFilters(new URLSearchParams("capa=casos&tema=agua potable&prioridad=high&estado=all&dependencia=00000000-0000-4000-b000-000000000002"));
    const period = { fromDay: "2026-10-01", toDay: "2026-10-07" };
    assert.equal(
      casesHref(filters, period, "sin"),
      "/casos?estado=all&desde=2026-10-01&hasta=2026-10-07&colonia=sin&categoria=agua+potable&prioridad=high&dependencia=00000000-0000-4000-b000-000000000002",
    );
    assert.deepEqual(caseRowFilters({ ...filters, colonia: "sin" }, period), {
      from: "2026-10-01",
      to: "2026-10-07",
      neighborhood: "none",
      category: "agua potable",
      priority: "high",
      status: "all",
      department: "00000000-0000-4000-b000-000000000002",
    });
  });

  it("drops malformed filters", () => {
    const f = parseMapFilters(new URLSearchParams("capa=x&estado=nope&colonia=1;drop&prioridad=urgente"));
    assert.deepEqual([f.capa, f.estado, f.colonia, f.prioridad], ["conversacion", "open", undefined, undefined]);
  });
});
