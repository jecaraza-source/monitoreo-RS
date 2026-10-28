import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rssBridgeConfigSchema, rssBridgeConnector } from "./rss-bridge.ts";

const FEED = `<?xml version="1.0"?><rss version="2.0"><channel><title>Telegram Channel - Avisos</title>
  <item><title>Corte de agua en Alvarado</title><link>https://t.me/avisos/10</link><guid>https://t.me/avisos/10</guid>
  <pubDate>Wed, 28 Oct 2026 10:00:00 GMT</pubDate><author>Avisos</author><description>Corte de agua mañana.</description></item>
</channel></rss>`;

describe("rssBridgeConnector", () => {
  it("reads the bridge feed as posts with no author", async () => {
    const fetch = (async () => new Response(FEED, { status: 200 })) as unknown as typeof globalThis.fetch;
    const config = rssBridgeConfigSchema.parse({ url: "https://rsshub.example.mx/telegram/channel/avisos", network: "telegram" });
    const r = await rssBridgeConnector.fetchSince({ id: "s", cursor: {}, config }, new Date("2026-10-28T00:00:00Z"), {
      fetch,
      now: () => new Date("2026-10-28T15:00:00Z"),
    });
    assert.equal(r.mentions.length, 1);
    assert.equal(r.mentions[0].kind, "post");
    assert.equal(r.mentions[0].author, null, "a bridge cannot vouch for who published");
    assert.equal(r.mentions[0].url, "https://t.me/avisos/10");
    assert.equal(rssBridgeConnector.official, false);
  });

  it("requires the network it reads", () => {
    assert.equal(rssBridgeConfigSchema.safeParse({ url: "https://rsshub.example.mx/x" }).success, false);
  });
});
