import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rateLimitMessage } from "./rate-limit.ts";

describe("rateLimitMessage", () => {
  it("ignores errors that are not rate limits", () => {
    assert.equal(rateLimitMessage(null), null);
    assert.equal(rateLimitMessage({ status: 400, code: "email_exists", message: "exists" }), null);
  });

  it("tells how many seconds to wait for the per-address cooldown", () => {
    const message = rateLimitMessage({
      status: 429,
      code: "over_email_send_rate_limit",
      message: "For security purposes, you can only request this after 42 seconds.",
    });
    assert.match(message!, /Espera 42 segundos/);
  });

  it("explains the hourly email cap", () => {
    const message = rateLimitMessage({ status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" });
    assert.match(message!, /límite de correos por hora/);
  });

  it("falls back to a generic wait for request limits", () => {
    const message = rateLimitMessage({ status: 429, code: "over_request_rate_limit", message: "Request rate limit reached" });
    assert.match(message!, /Espera unos minutos/);
  });
});
