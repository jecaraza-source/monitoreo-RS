import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canExport, exportRange, isExportKind, mxDayEnd, mxDayStart, toCsv } from "./model.ts";

describe("exports", () => {
  it("only authorized roles export each kind", () => {
    assert.equal(canExport("casos", "comunicacion"), true);
    assert.equal(canExport("casos", "dependencia"), false);
    assert.equal(canExport("casos", "lectura"), false);
    assert.equal(canExport("bitacora", "comunicacion"), false);
    assert.equal(canExport("consumo-ia", "admin"), true);
    assert.equal(isExportKind("menciones"), false, "no export of mentions or authors");
  });

  it("validates the period", () => {
    assert.deepEqual(exportRange("2026-09-01", "2026-09-30"), { from: "2026-09-01", to: "2026-09-30" });
    assert.ok("error" in exportRange("2026-09-30", "2026-09-01"));
    assert.ok("error" in exportRange("2025-01-01", "2026-09-01"));
    assert.ok("error" in exportRange(null, "2026-09-01"));
    assert.equal(mxDayStart("2026-09-01"), "2026-09-01T06:00:00.000Z");
    assert.equal(mxDayEnd("2026-09-01"), "2026-09-02T06:00:00.000Z");
  });

  it("writes CSV with quoting and neutralizes formulas", () => {
    const csv = toCsv(
      [
        { key: "a", label: "Título" },
        { key: "b", label: "Valor" },
      ],
      [{ a: 'Fuga, "grande"', b: "=HYPERLINK(1)" }, { a: null, b: { x: 1 } }],
    );
    assert.equal(csv, '﻿Título,Valor\r\n"Fuga, ""grande""",\'=HYPERLINK(1)\r\n,"{""x"":1}"\r\n');
  });
});
