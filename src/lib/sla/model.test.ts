import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maskAddress, slaProblem, type SlaTarget } from "./model.ts";

const general: SlaTarget[] = [
  { category: null, priority: "critical", accept_hours: 1, attention_hours: 8 },
  { category: null, priority: "high", accept_hours: 4, attention_hours: 24 },
  { category: null, priority: "medium", accept_hours: 8, attention_hours: 72 },
  { category: null, priority: "low", accept_hours: 24, attention_hours: 168 },
];
const calendar = { mode: "business" as const, workdays: [1, 2, 3, 4, 5], day_start: "09:00", day_end: "17:00" };

describe("SLA settings", () => {
  it("accepts a complete configuration", () => {
    assert.equal(slaProblem(calendar, general), null);
    assert.equal(slaProblem(calendar, [...general, { category: "agua potable", priority: "high", accept_hours: 2, attention_hours: 8 }]), null);
  });

  it("explains what to fix", () => {
    assert.equal(slaProblem({ ...calendar, workdays: [] }, general), "Elige al menos un día hábil.");
    assert.equal(slaProblem({ ...calendar, day_end: "08:00" }, general), "La hora de cierre debe ser después de la de apertura.");
    assert.equal(slaProblem(calendar, general.slice(1)), "Define los plazos generales de las cuatro prioridades.");
    assert.equal(
      slaProblem(calendar, general.map((t) => (t.priority === "high" ? { ...t, accept_hours: 30 } : t))),
      "La aceptación no puede tardar más que la atención.",
    );
    assert.equal(
      slaProblem(calendar, general.map((t) => (t.priority === "critical" ? { ...t, attention_hours: 100 } : t))),
      "Una prioridad mayor debe tener un plazo igual o menor.",
    );
    assert.equal(slaProblem(calendar, [...general, general[0]]), "Hay plazos repetidos para la misma categoría y prioridad.");
  });

  it("masks officials' addresses", () => {
    assert.equal(maskAddress("obras@monitoreo.test"), "o***@monitoreo.test");
    assert.equal(maskAddress("5215550000001"), "52155****001");
  });
});
