import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderEmail } from "./email.ts";
import { notify } from "./index.ts";
import type { AlertMessage } from "./types.ts";

const message: AlertMessage = {
  title: "Pico de menciones: 50 en 1 hora",
  summary: "Lo normal es <1>.",
  severity: "critical",
  ruleName: "Pico de volumen",
  orgName: "Alvarado",
  url: "https://monitoreo.example/alertas",
};

describe("notify", () => {
  it("reports unconfigured channels without calling out", async () => {
    let calls = 0;
    const result = await notify(message, { email: ["a@b.mx"], whatsapp: ["+5212345678901"] }, {
      env: {},
      fetch: (async () => { calls++; return new Response("{}"); }) as typeof fetch,
    });
    assert.equal(calls, 0);
    assert.equal(result.email.status, "not_configured");
    assert.equal(result.whatsapp.status, "not_configured");
    assert.equal(result.in_app.status, "sent");
  });

  it("sends email through Resend and WhatsApp per recipient", async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const result = await notify(message, { email: ["a@b.mx", "c@d.mx"], whatsapp: ["+5212345678901"] }, {
      env: { RESEND_API_KEY: "re_x", ALERTS_FROM_EMAIL: "Alertas <a@x.mx>", WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_TEMPLATE: "alerta" },
      fetch: fakeFetch,
    });
    assert.equal(result.email.status, "sent");
    assert.equal(result.whatsapp.status, "sent");
    assert.equal(seen[0].url, "https://api.resend.com/emails");
    assert.deepEqual(seen[0].body.to, ["a@b.mx", "c@d.mx"]);
    assert.equal((seen[1].body as { to: string }).to, "5212345678901");
  });

  it("skips channels without recipients and reports failures", async () => {
    const result = await notify(message, { email: ["a@b.mx"], whatsapp: [] }, {
      env: { RESEND_API_KEY: "re_x", ALERTS_FROM_EMAIL: "a@x.mx" },
      fetch: (async () => new Response("bad from", { status: 422 })) as unknown as typeof fetch,
    });
    assert.equal(result.email.status, "failed");
    assert.match(result.email.detail!, /422/);
    assert.equal(result.whatsapp.status, "skipped");
  });

  it("escapes HTML in the email", () => {
    assert.match(renderEmail(message).html, /Lo normal es &#60;1&#62;\./);
    assert.equal(renderEmail(message).subject, "[Crítica] Pico de menciones: 50 en 1 hora");
  });
});
