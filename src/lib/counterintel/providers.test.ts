import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkIndicator,
  gdeltDate,
  indicatorTarget,
  isOfficial,
  lookalikesFrom,
  parseFactCheck,
  parseGdelt,
  parsePhishstats,
  parseSafeBrowsing,
  parseUrlhaus,
  providerEnv,
  searchCertificates,
  searchFactChecks,
} from "./providers.ts";

describe("indicators", () => {
  it("checks URLs and domains, not handles or hashtags", () => {
    assert.deepEqual(indicatorTarget("https://www.Apoyos-Alvarado.mx/registro?x=1"), {
      kind: "url",
      host: "apoyos-alvarado.mx",
      url: "https://www.apoyos-alvarado.mx/registro?x=1",
    });
    assert.deepEqual(indicatorTarget("alvarado-gob.mx/pagos"), { kind: "domain", host: "alvarado-gob.mx", url: null });
    assert.equal(indicatorTarget("@ayto_falso"), null);
    assert.equal(indicatorTarget("#RumorAgua"), null);
    assert.equal(indicatorTarget("Página falsa del DIF"), null);
    assert.equal(indicatorTarget("http://10.0.0.1/"), null);
  });

  it("official domains cover their subdomains only", () => {
    assert.ok(isOfficial("alvarado.gob.mx", ["alvarado.gob.mx"]));
    assert.ok(isOfficial("dif.alvarado.gob.mx", ["alvarado.gob.mx"]));
    assert.ok(!isOfficial("alvarado-gob.mx", ["alvarado.gob.mx"]));
    assert.ok(!isOfficial("falsoalvarado.gob.mx", ["alvarado.gob.mx"]));
  });
});

describe("lookalikes from certificates", () => {
  it("keeps non-official domains with the term, earliest certificate, newest first", () => {
    const entries = [
      { name_value: "alvarado.gob.mx\nwww.alvarado.gob.mx", not_before: "2026-01-01T00:00:00", issuer_name: "C=US, O=Let's Encrypt, CN=R3" },
      { name_value: "*.apoyos-alvarado.mx\napoyos-alvarado.mx", not_before: "2026-10-20T00:00:00", issuer_name: "C=US, O=Let's Encrypt, CN=R3" },
      { name_value: "apoyos-alvarado.mx", not_before: "2026-10-10T00:00:00", issuer_name: "O=ZeroSSL" },
      { name_value: "alvaradoveracruz.com", not_before: "2026-10-25T00:00:00", issuer_name: null },
      { name_value: "otrodominio.mx", not_before: "2026-10-26T00:00:00" },
    ];
    const found = lookalikesFrom(entries, ["alvarado"], ["alvarado.gob.mx"]);
    assert.deepEqual(found.map((f) => f.domain), ["alvaradoveracruz.com", "apoyos-alvarado.mx"]);
    assert.equal(found[1].firstSeen, "2026-10-10T00:00:00");
    assert.equal(found[1].issuer, "ZeroSSL");
    assert.deepEqual(lookalikesFrom("no es lista", ["alvarado"], []), []);
  });
});

describe("parsers", () => {
  it("URLhaus: listed, not listed and errors", () => {
    const listed = parseUrlhaus("x.mx", { query_status: "ok", urls_count: 2, urls: [{ url: "http://x.mx/a", url_status: "online", threat: "malware_download" }, { url: "http://x.mx/b", url_status: "offline" }] });
    assert.equal(listed.status, "flagged");
    assert.match(listed.summary, /2 URL maliciosas \(1 en línea\)/);
    assert.equal(parseUrlhaus("x.mx", { query_status: "no_results" }).status, "clear");
    assert.equal(parseUrlhaus("x.mx", { query_status: "invalid_host" }).status, "error");
  });

  it("PhishStats and Safe Browsing", () => {
    assert.equal(parsePhishstats("x.mx", [{ url: "https://x.mx/login", title: "Pago", score: 8 }]).status, "flagged");
    assert.equal(parsePhishstats("x.mx", []).status, "clear");
    const sb = parseSafeBrowsing("https://x.mx/", { matches: [{ threatType: "SOCIAL_ENGINEERING" }, { threatType: "SOCIAL_ENGINEERING" }] });
    assert.equal(sb.status, "flagged");
    assert.deepEqual(sb.details.threats, ["SOCIAL_ENGINEERING"]);
    assert.equal(parseSafeBrowsing("https://x.mx/", {}).status, "clear");
  });

  it("Fact Check and GDELT", () => {
    const fc = parseFactCheck("agua alvarado", {
      claims: [{ text: "Se suspende el agua una semana", claimant: "Redes", claimReview: [{ publisher: { name: "Verificado" }, url: "https://v.mx/1", textualRating: "Falso", reviewDate: "2026-10-20" }] }],
    });
    assert.equal(fc.status, "found");
    assert.deepEqual((fc.details.items as { rating: string }[])[0].rating, "Falso");
    assert.equal(parseFactCheck("q", {}).status, "clear");
    assert.equal(gdeltDate("20261027T120000Z"), "2026-10-27T12:00:00Z");
    assert.equal(gdeltDate("ayer"), null);
    const news = parseGdelt("alvarado", { articles: [{ url: "https://m.mx/n", title: "Nota", domain: "m.mx", seendate: "20261027T120000Z" }, { title: "sin url" }] });
    assert.equal((news.details.items as unknown[]).length, 1);
  });
});

describe("requests", () => {
  const env = providerEnv({ GOOGLE_FACTCHECK_API_KEY: "k", RADAR_CRTSH_URL: "http://mock/crtsh/" });

  it("without a key the service is reported as not configured, without calling it", async () => {
    let called = 0;
    const fetchImpl = (async () => {
      called++;
      return new Response("[]");
    }) as typeof fetch;
    const results = await checkIndicator("https://apoyos-alvarado.mx/", providerEnv({}), fetchImpl);
    assert.deepEqual(results.map((r) => [r.provider, r.status]), [["urlhaus", "skipped"], ["phishstats", "clear"], ["safe_browsing", "skipped"]]);
    assert.equal(called, 1);
    assert.deepEqual(await checkIndicator("@cuenta", providerEnv({}), fetchImpl), []);
  });

  it("a failing service is an error result, never an exception", async () => {
    const down = (async () => new Response("boom", { status: 503 })) as typeof fetch;
    const r = await searchFactChecks("agua", env, down);
    assert.equal(r.status, "error");
    assert.match(r.summary, /HTTP 503/);
  });

  it("uses the base URL override and sends the query encoded", async () => {
    let seen = "";
    const fetchImpl = (async (url: string) => {
      seen = url;
      return new Response(JSON.stringify([{ name_value: "pagos-alvarado.mx", not_before: "2026-10-01T00:00:00" }]));
    }) as unknown as typeof fetch;
    const r = await searchCertificates("alvarado", ["alvarado.gob.mx"], env, fetchImpl);
    assert.equal(r.status, "found");
    assert.ok(seen.startsWith("http://mock/crtsh/?q=%25alvarado%25&output=json"), seen);
  });
});
