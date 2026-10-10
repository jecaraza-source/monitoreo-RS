import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFeed } from "../connectors/rss.ts";
import { DEMO_FEEDS, demoItems, demoRss } from "./feeds.ts";

const NOW = new Date("2026-10-10T15:30:00Z");

describe("demo feeds", () => {
  it("is stable within an hour and adds new items as hours pass", () => {
    const feed = DEMO_FEEDS[0];
    const a = demoItems(feed, NOW).map((i) => i.guid);
    const b = demoItems(feed, new Date(NOW.getTime() + 60_000)).map((i) => i.guid);
    const later = demoItems(feed, new Date(NOW.getTime() + 2 * 3_600_000)).map((i) => i.guid);
    assert.deepEqual(a.filter((g) => b.includes(g)).length, Math.min(a.length, b.length));
    assert.ok(later.some((g) => !a.includes(g)));
  });

  it("never dates items in the future and names the town", () => {
    for (const feed of DEMO_FEEDS) {
      for (const item of demoItems(feed, NOW)) {
        assert.ok(item.publishedAt <= NOW);
        assert.match(item.title + item.description, /Alvarado/);
      }
    }
  });

  it("produces a feed the RSS connector can parse", () => {
    const feed = DEMO_FEEDS[1];
    const parsed = parseFeed(demoRss(feed, "https://demo.example", NOW));
    assert.equal(parsed.title, feed.title);
    assert.equal(parsed.items.length, demoItems(feed, NOW).length);
    assert.ok(parsed.items.every((i) => i.id?.startsWith("demo:") && i.publishedAt));
  });
});
