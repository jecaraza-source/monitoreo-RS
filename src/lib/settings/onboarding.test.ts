import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MANUAL_CHECKS, onboardingChecklist, readiness, type OnboardingFacts } from "./onboarding.ts";

const ready: OnboardingFacts = {
  departments: 3,
  neighborhoods: 10,
  categories: 4,
  categoriesWithoutCapability: 0,
  departmentsWithoutLink: 0,
  departmentsWithoutHead: 0,
  departmentsWithoutUsers: 0,
  admins: 1,
  comunicacion: 2,
  activeSources: 2,
  sourcesReading: 2,
  verifiedAuthors: 5,
  slaApproved: true,
  retentionDecided: true,
  aiLimitsSet: true,
  manual: Object.fromEntries(MANUAL_CHECKS.map((m) => [m.key, { note: "Hecho en la capacitación", doneAt: "2026-10-13T10:00:00Z", doneBy: "Admin" }])),
};

describe("onboarding checklist", () => {
  it("a ready municipality has every item done", () => {
    const items = onboardingChecklist(ready);
    assert.deepEqual(readiness(items), { done: items.length, total: items.length });
  });

  it("flags what is missing with a useful detail", () => {
    const items = onboardingChecklist({ ...ready, categoriesWithoutCapability: 1, departmentsWithoutHead: 2, sourcesReading: 1, manual: {} });
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    assert.equal(byKey.categorias.ok, false);
    assert.match(byKey.categorias.detail, /1 categoría sin dependencia/);
    assert.equal(byKey.enlaces.ok, false);
    assert.match(byKey.enlaces.detail, /sin titular: 2/);
    assert.equal(byKey.fuentes.ok, false);
    assert.equal(items.filter((i) => i.manual && !i.ok).length, MANUAL_CHECKS.length);
  });

  it("an empty municipality is not ready", () => {
    const items = onboardingChecklist({ ...ready, departments: 0, neighborhoods: 0, categories: 0, activeSources: 0, sourcesReading: 0, manual: {} });
    assert.equal(items.find((i) => i.key === "dependencias")!.ok, false);
    assert.equal(items.find((i) => i.key === "fuentes")!.ok, false);
    assert.equal(items.find((i) => i.key === "enlaces")!.ok, false);
  });
});
