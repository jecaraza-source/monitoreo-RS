import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KPI_DEFINITIONS, KPI_VERSION } from "./dictionary.ts";
import { comparabilityNotes, compareDepartments, departmentsCsv, kpi, kpiValues, parseKpiSnapshot } from "./snapshot.ts";

// The pgTAP scenario (supabase/tests/database/kpi_snapshot.test.sql), as kpi_snapshot returns it.
const raw = {
  snapshot_version: 1,
  as_of: "2026-10-13T17:00:00Z",
  period: {
    from: "2025-01-13T06:00:00Z",
    to: "2025-01-16T06:00:00Z",
    cut: "2025-01-16T06:00:00Z",
    prev_from: "2025-01-10T06:00:00Z",
    prev_to: "2025-01-13T06:00:00Z",
    prev_cut: "2025-01-13T06:00:00Z",
  },
  conversation: {
    current: { mentions: 6, classified: 5, unclassified: 1, pending: 1, failed: 0, positive: 1, neutral: 1, negative: 3, complaints: 2, without_neighborhood: 2, without_topic: 1, interactions: 12 },
    previous: { mentions: 4, classified: 4, unclassified: 0, positive: 2, neutral: 1, negative: 1, complaints: 1, without_neighborhood: 0, interactions: 0 },
  },
  attention: {
    current: {
      opened: 3, opened_without_category: 1, open_at_cut: 3, overdue_at_cut: 2, awaiting_first_attention: 2,
      first_attention_n: 1, first_attention_median_h: 4.0, first_attention_p90_h: 4.0,
      resolution_n: 2, resolution_median_h: 40.0, resolution_p90_h: 48.8, validated_closures: 2, reopenings: 1,
    },
    previous: { opened: 1, open_at_cut: 1, first_attention_n: 1, first_attention_median_h: 3.0, resolution_n: 0, resolution_median_h: null, validated_closures: 0 },
  },
  departments: [
    { id: "b2", name: "Agua Potable y Alcantarillado", created_at: "2024-01-01T00:00:00Z", opened: 1, open_at_cut: 1, overdue_at_cut: 1, validated_closures: 1, resolution_median_h: 29, reopenings: 1, mentions: 2 },
    { id: null, name: "Sin asignar", created_at: null, opened: 1, open_at_cut: 1, overdue_at_cut: 0, validated_closures: 0, mentions: 0 },
    { id: "b1", name: "Obras Públicas", created_at: "2025-01-11T00:00:00Z", opened: 6, open_at_cut: 2, overdue_at_cut: 1, validated_closures: 4, resolution_median_h: 51, mentions: 2 },
  ],
  series: [],
  topics: [],
  pending_cases: [{ id: "k2", folio: "C-9002", category: "baches", priority: "medium", status: "assigned", department: "Obras Públicas", overdue_hours: 36 }],
  coverage: { sources_active: 4, sources_partial: [{ name: "Canal", type: "youtube", covered_until: null }], pending_corrections: 2 },
  catalog: { departments_added: ["Obras Públicas"], neighborhoods_added: 0, sources_added: [] },
};

describe("parseKpiSnapshot and kpiValues", () => {
  const s = parseKpiSnapshot(raw);

  it("keeps mentions and cases apart, with their units", () => {
    const conv = kpiValues(s, "conversacion");
    const att = kpiValues(s, "atencion");
    assert.ok(conv.every((v) => ["menciones", "interacciones", "puntos", "%"].includes(v.def.unit)));
    assert.ok(att.every((v) => ["casos", "horas"].includes(v.def.unit)));
    assert.equal(kpi(conv, "complaints")?.value, 2);
    assert.equal(kpi(att, "cases_opened")?.value, 3);
  });

  it("computes rates and NSS in code over the classified", () => {
    const conv = kpiValues(s, "conversacion");
    // (1 − 3) ÷ 5 × 100 = −40; previous (2 − 1) ÷ 4 × 100 = 25 → −65 points.
    assert.deepEqual([kpi(conv, "nss")?.value, kpi(conv, "nss")?.previous, kpi(conv, "nss")?.change], [-40, 25, -65]);
    assert.equal(kpi(conv, "nss")?.changeUnit, "puntos");
    assert.equal(kpi(conv, "negative_pct")?.value, 60);
    assert.equal(kpi(conv, "without_neighborhood_pct")?.value, 40);
    assert.equal(kpi(conv, "unclassified")?.detail, "16.7 % de las menciones");
    // Counts change in %: 6 vs 4 mentions → +50 %.
    assert.equal(kpi(conv, "mentions")?.change, 50);
  });

  it("reports times as median with p90 and n, and does not compare thin medians", () => {
    const att = kpiValues(s, "atencion");
    const resolution = kpi(att, "resolution_h")!;
    assert.deepEqual([resolution.value, resolution.n, resolution.detail], [40, 2, "p90 48.8 h"]);
    assert.equal(resolution.change, null);
    assert.equal(kpi(att, "first_attention_h")?.change, null);
    assert.equal(kpi(att, "overdue_at_cut")?.detail, "66.7 % de los abiertos");
    assert.equal(kpi(att, "cases_opened")?.change, 200);
  });

  it("explains coverage and catalog changes", () => {
    const notes = comparabilityNotes(s);
    assert.ok(notes.some((n) => n.includes("cobertura de clasificación")), notes.join("|"));
    assert.ok(notes.some((n) => n.includes("Dependencias nuevas")));
    assert.ok(notes.some((n) => n.includes("1 de 4 fuentes")));
    assert.ok(notes.some((n) => n.includes("2 correcciones")));
  });
});

describe("compareDepartments", () => {
  const rows = compareDepartments(parseKpiSnapshot(raw));

  it("orders alphabetically with Sin asignar last: a breakdown, not a ranking", () => {
    assert.deepEqual(rows.map((r) => r.name), ["Agua Potable y Alcantarillado", "Obras Públicas", "Sin asignar"]);
  });

  it("flags low volume, thin medians and catalog changes", () => {
    const agua = rows[0];
    const obras = rows[1];
    assert.equal(agua.lowVolume, true);
    assert.equal(agua.thinMedian, true);
    assert.equal(obras.lowVolume, false);
    assert.equal(obras.thinMedian, false);
    assert.equal(obras.newInCatalog, true);
    assert.equal(obras.overduePct, 50);
  });

  it("exports the same rows to CSV with a BOM and neutralized formulas", () => {
    const csv = departmentsCsv([{ ...rows[0], name: "=HYPERLINK(1)" }]);
    assert.ok(csv.startsWith("﻿Dependencia,"));
    assert.ok(csv.includes("'=HYPERLINK(1),1,1,1,100,1,29,,1,1,2,0,0,volumen bajo; mediana con pocos casos"), csv);
  });
});

describe("KPI dictionary", () => {
  it("is versioned and every KPI says where its figure comes from and how it is bounded", () => {
    assert.match(KPI_VERSION, /^KPI-\d{4}\.\d{2}$/);
    const keys = new Set<string>();
    for (const d of KPI_DEFINITIONS) {
      assert.ok(!keys.has(d.key), `duplicated ${d.key}`);
      keys.add(d.key);
      for (const field of ["formula", "source", "period", "denominator", "reopened", "missing"] as const) assert.ok(d[field].length > 0, `${d.key}.${field}`);
      assert.match(d.source, /^kpi_snapshot → /);
    }
  });

  it("has a value for every definition (no KPI without its base query)", () => {
    const s = parseKpiSnapshot(raw);
    for (const family of ["conversacion", "atencion"] as const) {
      for (const v of kpiValues(s, family)) assert.notEqual(v.value, undefined, v.def.key);
    }
    assert.equal(kpiValues(s, "conversacion").length + kpiValues(s, "atencion").length, KPI_DEFINITIONS.length);
  });
});
