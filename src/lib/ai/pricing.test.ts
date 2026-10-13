import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { callCost, formatUsd, hasTariff, normalizeModelId, priceUsage, tariffAt, TARIFFS } from "./pricing.ts";

const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadTokens: cacheRead,
  cacheWriteTokens: cacheWrite,
});

describe("normalizeModelId", () => {
  it("maps snapshots, aliases and provider ids to the tariff key", () => {
    assert.equal(normalizeModelId("claude-sonnet-5-5"), "claude-sonnet-5-5");
    assert.equal(normalizeModelId("claude-sonnet-5-5-20261001"), "claude-sonnet-5-5");
    assert.equal(normalizeModelId("Claude-Opus-5-5@20261001"), "claude-opus-5-5");
    assert.equal(normalizeModelId("claude-opus-5-5[1m]"), "claude-opus-5-5");
    assert.equal(normalizeModelId("anthropic.claude-haiku-5-5-v1:0"), "claude-haiku-5-5");
    assert.equal(normalizeModelId("claude-haiku-5-5-latest"), "claude-haiku-5-5");
    assert.equal(normalizeModelId("modelo-nuevo"), "modelo-nuevo");
  });
});

describe("priceUsage", () => {
  it("prices a known model with the tariff in force and its version", () => {
    const cost = priceUsage("claude-sonnet-5-5-20261001", usage(1_000_000, 100_000, 500_000, 200_000), new Date("2026-10-13T12:00:00Z"));
    assert.deepEqual(cost, { status: "priced", usd: 2 + 1 + 0.1 + 0.5, tariff: "2026-10" });
  });

  it("an unknown model has cost unknown — never 0 — and keeps the tariff version for the warning", () => {
    const cost = priceUsage("claude-futuro-9", usage(1000, 1000));
    assert.equal(cost.status, "unknown");
    assert.equal(cost.status === "unknown" && cost.reason, "no_tariff");
    assert.deepEqual(callCost("claude-futuro-9", usage(1000, 1000)), { costUsd: null, tariff: "2026-10" });
    assert.equal(hasTariff("claude-futuro-9"), false);
    assert.equal(hasTariff("claude-haiku-5-5-20261001"), true);
  });

  it("uses the long-context rate when published and unknown when the tier has no cache price", () => {
    const long = priceUsage("claude-haiku-5-5", usage(150_000, 1_000));
    assert.deepEqual(long, { status: "priced", usd: (150_000 * 0.5 + 1_000 * 2.5) / 1e6, tariff: "2026-10" });
    const cached = priceUsage("claude-haiku-5-5", usage(20_000, 1_000, 90_000));
    assert.equal(cached.status, "unknown");
    assert.equal(cached.status === "unknown" && cached.reason, "tier_without_price");
  });

  it("before the first tariff nothing is priced", () => {
    assert.equal(tariffAt(new Date("2020-01-01T00:00:00Z")), null);
    assert.equal(priceUsage("claude-opus-5-5", usage(10, 10), new Date("2020-01-01T00:00:00Z")).status, "unknown");
  });

  it("tariff versions are unique and every price is positive", () => {
    assert.equal(new Set(TARIFFS.map((t) => t.version)).size, TARIFFS.length);
    for (const t of TARIFFS) for (const p of Object.values(t.models)) for (const v of [p.input, p.output, p.cacheRead, p.cacheWrite]) assert.ok(v > 0);
  });
});

describe("formatUsd", () => {
  it("shows unknown as such, never as US$0.00", () => {
    assert.equal(formatUsd(null), "Costo desconocido");
    assert.equal(formatUsd(0), "US$0.00");
    assert.equal(formatUsd(0.0042), "US$0.0042");
    assert.equal(formatUsd(12.5), "US$12.50");
  });
});
