import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { knownCost, limitsOrDefault, summarize, type UsageRow } from "./model.ts";

const row = (over: Partial<UsageRow>): UsageRow => ({
  day: "2026-10-13",
  model: "claude-haiku-5-5",
  purpose: "classify",
  requests: 1,
  input_tokens: 100,
  output_tokens: 10,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  cost_usd: 0.5,
  unpriced_requests: 0,
  unpriced_tokens: 0,
  tariff_version: "2026-10",
  ...over,
});

describe("summarize", () => {
  it("keeps unknown cost apart from priced cost, with its tokens visible", () => {
    const s = summarize(
      [
        row({}),
        row({ model: "claude-nuevo", purpose: "report", cost_usd: 0, unpriced_requests: 2, unpriced_tokens: 900, requests: 2, input_tokens: 800, output_tokens: 100 }),
      ],
      [],
      "2026-10-13",
    );
    assert.equal(s.today.pricedUsd, 0.5);
    assert.equal(s.today.unpricedRequests, 2);
    assert.equal(s.today.unpricedTokens, 900);
    assert.equal(s.today.tokens, 110 + 900);
    assert.deepEqual(s.untariffed, ["claude-nuevo"]);
    const unknown = s.breakdown.find((b) => b.model === "claude-nuevo")!;
    // Only unknown-cost calls: the cost shown is null ("Costo desconocido"), never 0.
    assert.equal(knownCost(unknown), null);
    assert.equal(knownCost(s.today), 0.5);
  });

  it("reconciles each month with its invoice", () => {
    const s = summarize(
      [row({ day: "2026-09-10", cost_usd: 100 }), row({ day: "2026-08-10", cost_usd: 100 }), row({ day: "2026-07-03", cost_usd: 10, unpriced_requests: 1, unpriced_tokens: 5 })],
      [
        { id: "a", month: "2026-09-01", amount_usd: 103, reference: null, notes: null },
        { id: "b", month: "2026-08-01", amount_usd: 130, reference: null, notes: null },
        { id: "c", month: "2026-07-01", amount_usd: 20, reference: null, notes: null },
      ],
      "2026-10-13",
    );
    const by = Object.fromEntries(s.reconciliation.map((m) => [m.month, m]));
    assert.equal(by["2026-10-01"].status, "sin_factura");
    assert.equal(by["2026-09-01"].status, "conciliado");
    assert.equal(by["2026-08-01"].status, "diferencia");
    assert.equal(by["2026-08-01"].difference, 30);
    assert.equal(by["2026-07-01"].status, "incompleto");
    assert.equal(s.reconciliation.length, 6);
  });
});

describe("limitsOrDefault", () => {
  it("fills defaults per purpose", () => {
    const l = limitsOrDefault({ max_concurrent: { assistant: 3 } as never, daily_budget_usd: 5 });
    assert.equal(l.max_concurrent.assistant, 3);
    assert.equal(l.max_concurrent.classify, 2);
    assert.equal(l.daily_budget_usd, 5);
    assert.equal(l.monthly_budget_usd, null);
  });
});
