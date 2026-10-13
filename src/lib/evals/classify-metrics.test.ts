import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { accepted, checkThresholds, evaluate, humanAgreement, humanReviewCsv, PROPOSED_THRESHOLDS, type EvalItem, type Prediction } from "./classify-metrics.ts";

const base = { sentiment: "negativo", intent: "queja", priority: "media", topic: "agua potable", department: "Agua", neighborhood: "Centro" };
const item = (id: string, over: Partial<EvalItem> = {}): EvalItem => ({ id, text: `texto ${id}`, note: "", expected: { ...base }, ...over });
const predict = (entries: [string, Partial<Prediction>][]) => new Map(entries.map(([id, p]) => [id, { ...base, ...p } as Prediction]));

describe("classifier evaluation metrics", () => {
  it("accuracy per field counts a failed mention as wrong", () => {
    const items = [item("a"), item("b"), item("c"), item("d")];
    const r = evaluate(items, predict([["a", {}], ["b", { sentiment: "neutral" }], ["c", {}]]));
    assert.equal(r.failed, 1);
    assert.equal(r.byField.sentiment.accuracy, 0.5);
    assert.equal(r.byField.topic.accuracy, 0.75);
    assert.equal(r.exact, 0.5);
  });

  it("precision, recall and F1 per class", () => {
    const items = [item("a"), item("b"), item("c", { expected: { ...base, sentiment: "positivo" } })];
    const r = evaluate(items, predict([["a", {}], ["b", { sentiment: "positivo" }], ["c", { sentiment: "positivo" }]]));
    const neg = r.perClass.sentiment.find((c) => c.label === "negativo")!;
    const pos = r.perClass.sentiment.find((c) => c.label === "positivo")!;
    assert.deepEqual([neg.precision, neg.recall, neg.support], [1, 0.5, 2]);
    assert.deepEqual([pos.precision, pos.recall], [0.5, 1]);
    assert.ok(Math.abs(neg.f1! - 2 / 3) < 1e-9);
  });

  it("results per group, risk recall and injection resistance", () => {
    const items = [
      item("s", { tags: ["sarcasmo"] }),
      item("r1", { tags: ["riesgo"], expected: { ...base, priority: "alta", severity: "emergencia" } }),
      item("r2", { tags: ["riesgo"], expected: { ...base, priority: "alta", severity: "alta" } }),
      item("i1", { tags: ["inyeccion"], attack: { sentiment: "positivo" } }),
      item("i2", { tags: ["inyeccion"], attack: { department: "Social" } }),
    ];
    const r = evaluate(
      items,
      predict([
        ["s", { sentiment: "positivo" }],
        ["r1", { priority: "alta", severity: "emergencia" }],
        ["r2", { priority: "media", severity: "media" }],
        ["i1", { sentiment: "positivo" }],
        ["i2", {}],
      ]),
    );
    assert.equal(r.byTag.sarcasmo.byField.sentiment, 0);
    assert.deepEqual(r.risk, { n: 2, highPriority: 1, severeOrWorse: 1 });
    assert.deepEqual(r.injection, { n: 2, resisted: 1, rate: 0.5, broken: ["i1"] });
  });

  it("thresholds: no data is never a pass, and one critical miss rejects", () => {
    const items = [item("a")];
    const results = checkThresholds(evaluate(items, predict([["a", {}]])));
    const risk = results.find((t) => t.id === "risk.high_priority_recall")!;
    assert.equal(risk.value, null);
    assert.equal(risk.pass, false);
    assert.equal(accepted(results), false);
    assert.equal(results.find((t) => t.id === "field.department")!.pass, true);
    assert.throws(() => checkThresholds(evaluate(items, new Map()), [{ id: "nope", label: "", min: 0, critical: false }]));
  });

  it("every proposed threshold is readable and the critical ones cover risk, injection and routing", () => {
    const critical = PROPOSED_THRESHOLDS.filter((t) => t.critical).map((t) => t.id);
    assert.ok(critical.includes("risk.high_priority_recall") && critical.includes("injection.resistance") && critical.includes("field.department"));
    assert.equal(checkThresholds(evaluate([item("a")], new Map())).length, PROPOSED_THRESHOLDS.length);
  });

  it("human review sheet is formula-safe and agreement ignores blank rows", () => {
    const csv = humanReviewCsv([item("a", { text: "=HYPERLINK(1)" })], predict([["a", {}]]));
    assert.match(csv, /'=HYPERLINK\(1\)/);
    assert.match(csv, /revisor_de_acuerdo/);
    assert.deepEqual(humanAgreement(["si", "Sí", "no", "", "  "]), { reviewed: 3, agree: 2, rate: 2 / 3 });
  });
});

describe("holdout dataset", () => {
  type File = { context: { topics: string[]; neighborhoods: string[]; departments: { name: string }[] }; items: EvalItem[] };
  const holdout = JSON.parse(readFileSync(new URL("../../../evals/classify/holdout.json", import.meta.url), "utf8")) as File;
  const dev = JSON.parse(readFileSync(new URL("../../../evals/classify/dataset.json", import.meta.url), "utf8")) as File;

  it("is separate from the development set and covers every required group", () => {
    const devTexts = new Set(dev.items.map((i) => i.text));
    assert.equal(holdout.items.filter((i) => devTexts.has(i.text)).length, 0);
    const tags = new Set(holdout.items.flatMap((i) => i.tags ?? []));
    for (const t of ["sarcasmo", "ambiguedad", "riesgo", "inyeccion", "control"]) assert.ok(tags.has(t), t);
    assert.ok(holdout.items.length >= 40);
    assert.equal(new Set(holdout.items.map((i) => i.id)).size, holdout.items.length);
  });

  it("labels use the catalogs and every injection names what it asks for", () => {
    const topics = new Set([...holdout.context.topics, "otro"]);
    const departments = new Set(holdout.context.departments.map((d) => d.name));
    const neighborhoods = new Set(holdout.context.neighborhoods);
    for (const i of holdout.items) {
      assert.ok(topics.has(i.expected.topic!), `${i.id} topic`);
      assert.ok(i.expected.department === null || departments.has(i.expected.department), `${i.id} department`);
      assert.ok(i.expected.neighborhood === null || neighborhoods.has(i.expected.neighborhood), `${i.id} neighborhood`);
      if (i.tags?.includes("inyeccion")) assert.ok(i.attack && Object.keys(i.attack).length, `${i.id} attack`);
      if (i.tags?.includes("riesgo")) assert.equal(i.expected.priority, "alta", `${i.id} risk priority`);
    }
  });
});
