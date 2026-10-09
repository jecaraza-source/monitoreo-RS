import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFeed, rssConnector } from "./rss.ts";
import { ConnectorError } from "./types.ts";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Diario del Valle</title>
  <atom:link href="https://diario.example/feed" rel="self"/>
  <item>
    <title><![CDATA[Bacheo en la colonia Centro &amp; alrededores]]></title>
    <link>https://diario.example/notas/bacheo?id=1&amp;s=rss</link>
    <guid isPermaLink="false">nota-1</guid>
    <pubDate>Fri, 09 Oct 2026 14:00:00 GMT</pubDate>
    <dc:creator>Redacción</dc:creator>
    <description>&lt;p&gt;El ayuntamiento inició trabajos de &lt;b&gt;bacheo&lt;/b&gt;.&lt;/p&gt;</description>
    <content:encoded><![CDATA[<p>El ayuntamiento inició trabajos de <b>bacheo</b> en la colonia Centro.</p><p>Duran 3 d&iacute;as.</p>]]></content:encoded>
  </item>
  <item>
    <title>Nota sin guid</title>
    <link>https://diario.example/notas/2</link>
    <description>Vecinos piden alumbrado</description>
    <pubDate>Thu, 08 Oct 2026 10:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Nota vieja</title>
    <link>https://diario.example/notas/3</link>
    <pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Sin fecha ni enlace</title>
    <description>Texto suelto</description>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">Noticias Atom</title>
  <entry>
    <id>tag:noticias.example,2026:1</id>
    <title type="html">Inundaci&#243;n en Las Flores</title>
    <link rel="alternate" type="text/html" href="https://noticias.example/1"/>
    <link rel="edit" href="https://noticias.example/edit/1"/>
    <published>2026-10-09T12:00:00Z</published>
    <author><name>Ana</name></author>
    <summary>Protección Civil atiende el encharcamiento.</summary>
  </entry>
</feed>`;

const RDF = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel><title>RDF News</title></channel>
  <item rdf:about="https://rdf.example/a"><title>Item RDF</title><link>https://rdf.example/a</link><dc:date>2026-10-09T08:00:00Z</dc:date></item>
</rdf:RDF>`;

const fakeFetch = (body: string, status = 200) =>
  (async () => new Response(body, { status, headers: { "content-type": "application/rss+xml" } })) as typeof fetch;

const source = (config = { url: "https://www.diario.example/feed" }) => ({ id: "s1", config, cursor: {} });
const now = () => new Date("2026-10-09T15:00:00Z");

describe("parseFeed", () => {
  it("reads RSS 2.0 with CDATA, escaped HTML and entities", () => {
    const feed = parseFeed(RSS);
    assert.equal(feed.title, "Diario del Valle");
    const [first] = feed.items;
    assert.equal(first.id, "nota-1");
    assert.equal(first.title, "Bacheo en la colonia Centro & alrededores");
    assert.equal(first.link, "https://diario.example/notas/bacheo?id=1&s=rss");
    assert.equal(first.body, "El ayuntamiento inició trabajos de bacheo en la colonia Centro.\nDuran 3 días.");
    assert.equal(first.author, "Redacción");
    assert.equal(first.publishedAt?.toISOString(), "2026-10-09T14:00:00.000Z");
  });

  it("reads Atom (alternate link, numeric entities)", () => {
    const [entry] = parseFeed(ATOM).items;
    assert.equal(entry.id, "tag:noticias.example,2026:1");
    assert.equal(entry.title, "Inundación en Las Flores");
    assert.equal(entry.link, "https://noticias.example/1");
    assert.equal(entry.body, "Protección Civil atiende el encharcamiento.");
  });

  it("reads RSS 1.0 (RDF)", () => {
    const feed = parseFeed(RDF);
    assert.equal(feed.items[0].link, "https://rdf.example/a");
    assert.equal(feed.items[0].publishedAt?.toISOString(), "2026-10-09T08:00:00.000Z");
  });

  it("rejects HTML pages", () => {
    assert.throws(() => parseFeed("<html><body>Hola</body></html>"), ConnectorError);
  });
});

describe("rssConnector.fetchSince", () => {
  it("normalizes items newer than `since`, with stable ids", async () => {
    const since = new Date("2026-10-01T00:00:00Z");
    const { mentions } = await rssConnector.fetchSince(source(), since, { fetch: fakeFetch(RSS), now });
    assert.deepEqual(
      mentions.map((m) => m.externalId),
      ["nota-1", "https://diario.example/notas/2", mentions[2].externalId],
    );
    assert.match(mentions[2].externalId, /^sha1:[0-9a-f]{40}$/); // no guid, no link
    assert.equal(mentions[0].text.startsWith("Bacheo en la colonia Centro & alrededores — El ayuntamiento"), true);
    assert.deepEqual(mentions[0].author, {
      platform: "rss",
      handle: "diario.example",
      displayName: "Diario del Valle",
      followers: null,
      kind: "media",
    });
    assert.equal(mentions[2].publishedAt, now().toISOString()); // undated → now
    assert.equal(mentions.every((m) => m.kind === "article"), true);
  });

  it("produces the same ids on every read (dedupe key)", async () => {
    const since = new Date("2026-10-01T00:00:00Z");
    const a = await rssConnector.fetchSince(source(), since, { fetch: fakeFetch(RSS), now });
    const b = await rssConnector.fetchSince(source(), since, { fetch: fakeFetch(RSS), now });
    assert.deepEqual(a.mentions.map((m) => m.externalId), b.mentions.map((m) => m.externalId));
  });

  it("prefers the configured outlet name", async () => {
    const { mentions } = await rssConnector.fetchSince(
      source({ url: "https://diario.example/feed", outletName: "El Diario" } as never),
      new Date(0),
      { fetch: fakeFetch(RSS), now },
    );
    assert.equal(mentions[0].author?.displayName, "El Diario");
  });

  it("reports HTTP errors", async () => {
    await assert.rejects(
      rssConnector.fetchSince(source(), new Date(0), { fetch: fakeFetch("not found", 404), now }),
      /HTTP 404/,
    );
  });

  it("validates the config", () => {
    assert.equal(rssConnector.configSchema.safeParse({ url: "ftp://x" }).success, false);
    assert.equal(rssConnector.configSchema.safeParse({ url: "https://diario.example/rss" }).success, true);
  });
});
