import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientIp, policyFor } from "./rate-limit-policy.ts";
import { scrub } from "./scrub.ts";

describe("rate limit policies", () => {
  it("covers every /api route and nothing else", () => {
    assert.equal(policyFor("/dashboard"), null);
    assert.deepEqual(policyFor("/api/asistente"), { name: "assistant", limit: 20, windowSeconds: 60, by: "user" });
    assert.equal(policyFor("/api/cron/ingest")?.name, "cron");
    assert.equal(policyFor("/api/demo/rss/x")?.name, "demo");
    assert.equal(policyFor("/api/errors")?.name, "errors");
    assert.equal(policyFor("/api/algo-nuevo")?.name, "api");
  });

  it("takes the first forwarded IP", () => {
    assert.equal(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
    assert.equal(clientIp(new Headers()), "unknown");
  });
});

describe("error scrubbing", () => {
  it("masks keys and tokens before storing an error", () => {
    const out = scrub("fallo con sk-ant-api03-abcdefghijklmnop y ?access_token=EAAB123&x=1 y re_ABCDEFGH12345678xyz");
    assert.ok(!out.includes("sk-ant-api03"));
    assert.ok(out.includes("access_token=***"));
    assert.ok(!out.includes("re_ABCDEFGH"));
  });
});
