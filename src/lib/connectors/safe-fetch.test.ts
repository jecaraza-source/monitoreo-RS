import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { fetchText, withDeadline } from "./http.ts";
import { rssConnector } from "./rss.ts";
import { BlockedDestinationError, createSafeFetch, hostAllowed, isBlockedAddress, parseAllowedHosts } from "./safe-fetch.ts";

describe("isBlockedAddress", () => {
  const blocked = [
    "127.0.0.1", "127.255.255.254", "0.0.0.0", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.10",
    "169.254.169.254", "100.64.0.1", "100.100.100.200", "192.0.0.170", "198.18.0.1", "224.0.0.1", "255.255.255.255",
    "::", "::1", "fe80::1", "fe80::1%eth0", "fc00::1", "fd00:ec2::254", "ff02::1", "2001:db8::1", "fec0::1",
    // IPv4 inside IPv6
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "::ffff:10.0.0.1", "::127.0.0.1",
    "64:ff9b::a9fe:a9fe", "64:ff9b:1::10.0.0.1", "2002:7f00:1::", "2002:a9fe:a9fe::1", "2001:0:4136:e378::1",
    // not an IP at all
    "localhost", "", "1.2.3", "::ffff:999.1.1.1", "1::2::3",
  ];
  const allowed = ["8.8.8.8", "93.184.216.34", "172.32.0.1", "100.128.0.1", "2606:4700::1111", "::ffff:8.8.8.8", "2002:808:808::1"];

  for (const address of blocked) it(`blocks ${address || "(empty)"}`, () => assert.equal(isBlockedAddress(address), true));
  for (const address of allowed) it(`allows ${address}`, () => assert.equal(isBlockedAddress(address), false));
});

describe("RSS_ALLOWED_HOSTS", () => {
  it("is optional", () => {
    assert.equal(parseAllowedHosts(undefined), null);
    assert.equal(parseAllowedHosts(" , "), null);
    assert.equal(hostAllowed("cualquiera.mx", null), true);
  });

  it("matches exact hosts and dotted suffixes", () => {
    const list = parseAllowedHosts("diario.mx, .noticias.com.mx");
    assert.equal(hostAllowed("diario.mx", list), true);
    assert.equal(hostAllowed("DIARIO.mx.", list), true);
    assert.equal(hostAllowed("www.diario.mx", list), false);
    assert.equal(hostAllowed("noticias.com.mx", list), true);
    assert.equal(hostAllowed("feeds.noticias.com.mx", list), true);
    assert.equal(hostAllowed("falsonoticias.com.mx", list), false);
    assert.equal(hostAllowed("noticias.com.mx.evil.test", list), false);
  });
});

// A local server stands in for the internet. Only "public.test" (and the
// rebinding host while it resolves well) are mapped to it; the policy treats
// 127.0.0.1 as public through an explicit test override, every other address
// goes through the real isBlockedAddress.
let server: Server;
let origin: string;
let port: number;
const hits: string[] = [];
let closedEarly = 0;

function handler(req: IncomingMessage, res: ServerResponse) {
  hits.push(req.url ?? "");
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/feed") {
    res.writeHead(200, { "content-type": "application/rss+xml" });
    res.end(`<rss><channel><title>Local</title><item><title>Bacheo</title><link>javascript:alert(1)</link><guid>1</guid></item></channel></rss>`);
  } else if (url.pathname === "/to") {
    res.writeHead(302, { location: url.searchParams.get("u") ?? "/" });
    res.end();
  } else if (url.pathname === "/loop") {
    res.writeHead(301, { location: `/loop?n=${Number(url.searchParams.get("n") ?? 0) + 1}` });
    res.end();
  } else if (url.pathname === "/endless") {
    // No Content-Length: chunks until the client goes away.
    res.writeHead(200, { "content-type": "text/plain" });
    const chunk = Buffer.alloc(64 * 1024, 97);
    const timer = setInterval(() => res.write(chunk), 1);
    res.on("close", () => {
      clearInterval(timer);
      closedEarly++;
    });
  } else if (url.pathname === "/liar") {
    // A large body with no Content-Length at all (chunked).
    res.writeHead(200, { "transfer-encoding": "chunked" });
    res.end(Buffer.alloc(3 * 1024 * 1024, 98));
  } else if (url.pathname === "/slow") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("a");
    const timer = setInterval(() => res.write("a"), 50);
    res.on("close", () => {
      clearInterval(timer);
      closedEarly++;
    });
  } else {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  }
}

before(async () => {
  server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  origin = `http://public.test:${port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const LOCAL_AS_PUBLIC = (address: string) => address !== "127.0.0.1" && isBlockedAddress(address);

function dns(table: Record<string, string[] | (() => string[])>) {
  const calls: string[] = [];
  const resolve = async (hostname: string) => {
    calls.push(hostname);
    const entry = table[hostname];
    const list = typeof entry === "function" ? entry() : entry;
    if (!list) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
    return list.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
  return { resolve, calls };
}

describe("createSafeFetch", () => {
  it("fetches a public host", async () => {
    const f = createSafeFetch({ resolve: dns({ "public.test": ["127.0.0.1"] }).resolve, isBlocked: LOCAL_AS_PUBLIC });
    const res = await f(`${origin}/hola`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "ok");
  });

  it("blocks internal IP literals before connecting, with the real policy", async () => {
    const f = createSafeFetch();
    const before = hits.length;
    for (const url of [
      `http://127.0.0.1:${port}/`,
      `http://[::1]:${port}/`,
      `http://[::ffff:127.0.0.1]:${port}/`,
      `http://2130706433:${port}/`, // 127.0.0.1 in decimal
      `http://0x7f.1:${port}/`,
      "http://169.254.169.254/latest/meta-data/",
      "http://[fd00:ec2::254]/",
      "http://10.0.0.1/",
    ]) {
      await assert.rejects(f(url), BlockedDestinationError, url);
    }
    assert.equal(hits.length, before, "no request reached the server");
  });

  it("blocks names that resolve to internal addresses (localhost, private DNS)", async () => {
    await assert.rejects(createSafeFetch()(`http://localhost:${port}/`), BlockedDestinationError);
    const { resolve } = dns({ "intranet.test": ["10.20.30.40"], "mixed.test": ["8.8.8.8", "127.0.0.1"], "v6.test": ["::1"] });
    const f = createSafeFetch({ resolve });
    for (const host of ["intranet.test", "mixed.test", "v6.test"]) {
      await assert.rejects(f(`http://${host}:${port}/`), BlockedDestinationError, host);
    }
  });

  it("checks the address the socket connects to (DNS rebinding)", async () => {
    let n = 0;
    // Public on the first resolution, loopback afterwards.
    const { resolve, calls } = dns({ "rebind.test": () => (n++ === 0 ? ["127.0.0.1"] : ["127.0.0.2"]) });
    const f = createSafeFetch({ resolve, isBlocked: LOCAL_AS_PUBLIC });
    const first = await f(`http://rebind.test:${port}/a`);
    assert.equal(await first.text(), "ok");
    const before = hits.length;
    await assert.rejects(f(`http://rebind.test:${port}/b`), BlockedDestinationError);
    assert.equal(hits.length, before);
    assert.deepEqual(calls, ["rebind.test", "rebind.test"], "resolved once per connection, by the socket");
  });

  it("re-validates every redirect", async () => {
    const { resolve } = dns({ "public.test": ["127.0.0.1"], "intranet.test": ["192.168.0.10"] });
    const f = createSafeFetch({ resolve, isBlocked: LOCAL_AS_PUBLIC });
    for (const target of [
      "http://169.254.169.254/latest/meta-data/",
      `http://intranet.test:${port}/`,
      `http://[::1]:${port}/`,
      "file:///etc/passwd",
      `http://user:pass@public.test:${port}/`,
    ]) {
      await assert.rejects(f(`${origin}/to?u=${encodeURIComponent(target)}`), BlockedDestinationError, target);
    }
    const ok = await f(`${origin}/to?u=${encodeURIComponent("/hola")}`);
    assert.equal(await ok.text(), "ok");
  });

  it("stops after five redirects", async () => {
    const f = createSafeFetch({ resolve: dns({ "public.test": ["127.0.0.1"] }).resolve, isBlocked: LOCAL_AS_PUBLIC });
    const before = hits.length;
    await assert.rejects(f(`${origin}/loop`), /redirige demasiadas veces \(más de 5\)/);
    assert.equal(hits.length - before, 6, "the first request plus five hops");
  });

  it("applies the allowlist to the first URL and to redirects", async () => {
    const f = createSafeFetch({
      resolve: dns({ "public.test": ["127.0.0.1"], "other.test": ["127.0.0.1"] }).resolve,
      isBlocked: LOCAL_AS_PUBLIC,
      allowedHosts: ["public.test"],
    });
    assert.equal(await (await f(`${origin}/hola`)).text(), "ok");
    await assert.rejects(f(`http://other.test:${port}/`), BlockedDestinationError);
    await assert.rejects(f(`${origin}/to?u=${encodeURIComponent(`http://other.test:${port}/`)}`), BlockedDestinationError);
  });

  it("only speaks http(s) GET", async () => {
    const f = createSafeFetch();
    await assert.rejects(f("ftp://example.com/feed"), BlockedDestinationError);
    await assert.rejects(f("https://example.com/", { method: "POST" }), TypeError);
  });
});

describe("fetchText streaming", () => {
  const f = () => createSafeFetch({ resolve: dns({ "public.test": ["127.0.0.1"] }).resolve, isBlocked: LOCAL_AS_PUBLIC });

  it("cancels an endless body at the byte cap and closes the connection", async () => {
    const closed = closedEarly;
    const started = Date.now();
    await assert.rejects(fetchText(f(), `${origin}/endless`, { maxBytes: 1024 * 1024 }), /pesa más de 1 MB/);
    assert.ok(Date.now() - started < 5000);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(closedEarly, closed + 1, "the server saw the client go away");
  });

  it("caps bodies that declare no Content-Length", async () => {
    await assert.rejects(fetchText(f(), `${origin}/liar`, { maxBytes: 1024 * 1024 }), /pesa más de 1 MB/);
  });

  it("rejects a declared Content-Length over the cap without reading", async () => {
    const fake = (async () => new Response("x".repeat(10), { headers: { "content-length": String(50 * 1024 * 1024) } })) as typeof fetch;
    await assert.rejects(fetchText(fake, "https://grande.example/feed"), /pesa más de 5 MB/);
  });

  it("counts bytes, not characters", async () => {
    const fake = (async () => new Response("ñ".repeat(600))) as typeof fetch; // 1200 bytes
    await assert.rejects(fetchText(fake, "https://x.example/", { maxBytes: 1000 }), /pesa más de/);
    assert.equal((await fetchText(fake, "https://x.example/", { maxBytes: 1200 })).text, "ñ".repeat(600));
  });

  it("cancels a stream that never ends from a fetch without a body limit", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull: (c) => c.enqueue(new Uint8Array(64 * 1024)),
      cancel: () => void (cancelled = true),
    });
    const fake = (async () => new Response(stream)) as typeof fetch;
    await assert.rejects(fetchText(fake, "https://x.example/", { maxBytes: 256 * 1024 }), /pesa más de/);
    assert.equal(cancelled, true);
  });

  it("times out a body that trickles in", async () => {
    const closed = closedEarly;
    await assert.rejects(fetchText(f(), `${origin}/slow`, { timeoutMs: 300 }), /public\.test:\d+ tardó demasiado en responder/);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(closedEarly, closed + 1);
  });

  it("stops when the caller cancels, with the caller's reason", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);
    await assert.rejects(fetchText(f(), `${origin}/slow`, { signal: controller.signal }), /se canceló/);
  });

  it("keeps tokens out of error messages", async () => {
    const failing = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as typeof fetch;
    await assert.rejects(fetchText(failing, "https://graph.example/v1/me?access_token=SECRETO123"), (error: Error) => {
      assert.equal(error.message, "graph.example no respondió.");
      return true;
    });
  });
});

describe("rss connector", () => {
  it("drops non-web item links", async () => {
    const fetch = createSafeFetch({ resolve: dns({ "public.test": ["127.0.0.1"] }).resolve, isBlocked: LOCAL_AS_PUBLIC });
    const source = { id: "s", config: { url: `${origin}/feed`, requireMatch: false }, cursor: {} };
    const { mentions } = await rssConnector.fetchSince(source, new Date(0), { fetch });
    assert.equal(mentions.length, 1);
    assert.equal(mentions[0].url, null);
  });

  it("refuses internal feed URLs by default", async () => {
    const source = { id: "s", config: { url: `http://127.0.0.1:${port}/feed` }, cursor: {} };
    const before = hits.length;
    await assert.rejects(rssConnector.fetchSince(source, new Date(0)), BlockedDestinationError);
    assert.equal(hits.length, before);
  });

  it("propagates cancellation from the caller", async () => {
    const fetch = createSafeFetch({ resolve: dns({ "public.test": ["127.0.0.1"] }).resolve, isBlocked: LOCAL_AS_PUBLIC });
    const source = { id: "s", config: { url: `${origin}/slow` }, cursor: {} };
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(rssConnector.fetchSince(source, new Date(0), { fetch, signal: controller.signal }), /se canceló/);
  });
});

describe("withDeadline", () => {
  it("aborts the connector's work on timeout and reports it", async () => {
    let seen: AbortSignal | undefined;
    const work = (signal: AbortSignal) => {
      seen = signal;
      return new Promise<string>(() => {}); // never settles on its own
    };
    await assert.rejects(withDeadline(work, 50), /La fuente tardó demasiado/);
    assert.equal(seen?.aborted, true);
  });

  it("cancels an in-flight feed read and frees the connection", async () => {
    const fetch = createSafeFetch({ resolve: dns({ "public.test": ["127.0.0.1"] }).resolve, isBlocked: LOCAL_AS_PUBLIC });
    const source = { id: "s", config: { url: `${origin}/slow` }, cursor: {} };
    const closed = closedEarly;
    await assert.rejects(
      withDeadline((signal) => rssConnector.fetchSince(source, new Date(0), { fetch, signal }), 150),
      /La fuente tardó demasiado/,
    );
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(closedEarly, closed + 1);
  });

  it("returns the result and aborts leftovers", async () => {
    let seen: AbortSignal | undefined;
    assert.equal(await withDeadline(async (signal) => ((seen = signal), "listo"), 1000), "listo");
    assert.equal(seen?.aborted, true);
  });
});
