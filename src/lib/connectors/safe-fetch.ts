// Outbound HTTP for URLs typed by users (RSS feeds).
//
// Blocks loopback, private, link-local, metadata and other non-public
// destinations in IPv4 and IPv6. The check runs inside the socket's DNS lookup,
// so the address that gets connected is the one that was checked: a hostname
// that resolves to a public IP when validated and to 127.0.0.1 on connect (DNS
// rebinding) cannot slip through. Redirects are followed by hand, at most
// MAX_REDIRECTS, and every hop is checked again. Optionally, RSS_ALLOWED_HOSTS
// restricts the hosts further (exact host, or ".example.com" for subdomains).
import { lookup as dnsLookup } from "node:dns/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { ConnectorError } from "./types.ts";

export const MAX_REDIRECTS = 5;

/** Same message for every blocked destination: the error does not reveal how the host resolved. */
export class BlockedDestinationError extends ConnectorError {
  constructor() {
    super("La URL de la fuente no está permitida: debe ser una dirección pública de internet autorizada.");
    this.name = "BlockedDestinationError";
  }
}

const blockList = new BlockList();
// IANA special-purpose IPv4 (RFC 6890 and updates).
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT (and Alibaba's 100.100.100.200 metadata)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. broadcast
] as const) {
  blockList.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["100::", 64], // discard
  ["2001::", 32], // Teredo (tunnels an arbitrary IPv4)
  ["2001:10::", 28], // ORCHID
  ["2001:20::", 28], // ORCHIDv2
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local, incl. AWS metadata fd00:ec2::254
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
] as const) {
  blockList.addSubnet(net, prefix, "ipv6");
}

/** The eight 16-bit groups of an IPv6 address, or null if it is not one. */
function ipv6Groups(address: string): number[] | null {
  let text = address.split("%")[0].toLowerCase();
  // Trailing dotted IPv4 (::ffff:127.0.0.1) becomes two groups.
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (isIP(dotted[2]) !== 4) return null;
    const [a, b, c, d] = dotted[2].split(".").map(Number);
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)) : []);
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const groups = halves.length === 2 ? [...head, ...Array(8 - head.length - tail.length).fill(0), ...tail] : head;
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0) ? groups : null;
}

const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** IPv4 carried inside an IPv6 address (mapped, compatible, NAT64, 6to4), if any. */
function embeddedIpv4(groups: number[]): string | null {
  const zeros = (from: number, to: number) => groups.slice(from, to).every((g) => g === 0);
  if (zeros(0, 5) && (groups[5] === 0xffff || groups[5] === 0)) return v4(groups[6], groups[7]); // ::ffff:a.b.c.d, ::a.b.c.d
  if (groups[0] === 0x64 && groups[1] === 0xff9b && zeros(2, 6)) return v4(groups[6], groups[7]); // NAT64 64:ff9b::/96
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups[2] === 1) return v4(groups[6], groups[7]); // local NAT64 64:ff9b:1::/48
  if (groups[0] === 0x2002) return v4(groups[1], groups[2]); // 6to4
  return null;
}

/** True when the address is not a public unicast destination. Anything that is not an IP is blocked. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address.split("%")[0]);
  if (family === 4) return blockList.check(address, "ipv4");
  if (family !== 6) return true;
  const groups = ipv6Groups(address);
  if (!groups) return true;
  const inner = embeddedIpv4(groups);
  if (inner && blockList.check(inner, "ipv4")) return true;
  return blockList.check(groups.map((g) => g.toString(16)).join(":"), "ipv6");
}

/** RSS_ALLOWED_HOSTS: comma separated; "diario.mx" matches that host, ".diario.mx" its subdomains too. */
export function parseAllowedHosts(value: string | undefined): string[] | null {
  const list = (value ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : null;
}

export function hostAllowed(host: string, allowed: string[] | null): boolean {
  if (!allowed) return true;
  const h = host.toLowerCase().replace(/\.$/, "");
  return allowed.some((rule) => (rule.startsWith(".") ? h === rule.slice(1) || h.endsWith(rule) : h === rule));
}

export type ResolvedAddress = { address: string; family: number };

export type SafeFetchOptions = {
  /** Hostname resolver; tests replace it. Defaults to the OS resolver (getaddrinfo). */
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  /** Address policy; tests may relax it to reach a local server. */
  isBlocked?: (address: string) => boolean;
  /** Host allowlist (see parseAllowedHosts); null allows any public host. */
  allowedHosts?: string[] | null;
  maxRedirects?: number;
};

const defaultResolve = (hostname: string) => dnsLookup(hostname, { all: true, verbatim: true });

/** Checks scheme, credentials, allowlist and (for IP literals) the address, before any connection. */
function checkUrl(url: URL, allowed: string[] | null, isBlocked: (address: string) => boolean) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedDestinationError();
  if (url.username || url.password) throw new BlockedDestinationError();
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || !hostAllowed(host, allowed)) throw new BlockedDestinationError();
  // Node skips the lookup for IP literals, so they are checked here.
  if (isIP(host) && isBlocked(host)) throw new BlockedDestinationError();
}

/** Lookup used by the socket itself: rejects the connection if any resolved address is blocked. */
function guardedLookup(resolve: NonNullable<SafeFetchOptions["resolve"]>, isBlocked: (address: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        if (!addresses.length) {
          callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }), "", 4);
          return;
        }
        if (addresses.some((a) => isBlocked(a.address))) {
          callback(new BlockedDestinationError(), "", 4);
          return;
        }
        if (options.all) (callback as unknown as (e: null, a: ResolvedAddress[]) => void)(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
      (error: NodeJS.ErrnoException) => callback(error, "", 4),
    );
  };
}

function request(url: URL, headers: Record<string, string>, signal: AbortSignal | undefined, lookup: LookupFunction) {
  return new Promise<IncomingMessage>((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(url, { method: "GET", headers, signal, lookup, agent: false }, resolve);
    req.on("error", reject);
    req.end();
  });
}

const NULL_BODY = new Set([204, 205, 304]);

function toResponse(res: IncomingMessage): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(res.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  const status = res.statusCode ?? 502;
  if (NULL_BODY.has(status)) {
    res.destroy();
    return new Response(null, { status, headers });
  }
  return new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, { status, headers });
}

/**
 * A fetch (GET only) that refuses non-public destinations. The body is a
 * stream: the caller reads it with a byte cap (see readCapped in http.ts) and
 * the signal cancels both the connection and the body.
 */
export function createSafeFetch(options: SafeFetchOptions = {}): typeof fetch {
  const isBlocked = options.isBlocked ?? isBlockedAddress;
  const lookup = guardedLookup(options.resolve ?? defaultResolve, isBlocked);
  const allowed = options.allowedHosts ?? null;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;

  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if ((init.method ?? "GET").toUpperCase() !== "GET") throw new TypeError("safeFetch only supports GET.");
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const signal = init.signal ?? undefined;
    let url = new URL(input instanceof Request ? input.url : String(input));

    for (let hop = 0; ; hop++) {
      checkUrl(url, allowed, isBlocked);
      signal?.throwIfAborted();
      const res = await request(url, headers, signal, lookup);
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (![301, 302, 303, 307, 308].includes(status) || !location) return toResponse(res);
      res.destroy();
      if (hop >= maxRedirects) throw new ConnectorError(`La fuente redirige demasiadas veces (más de ${maxRedirects}).`);
      url = new URL(location, url);
    }
  }) as typeof fetch;
}

let rssFetch: typeof fetch | null = null;

/** Safe fetch with the RSS_ALLOWED_HOSTS allowlist, for feeds. */
export function feedFetch(): typeof fetch {
  rssFetch ??= createSafeFetch({ allowedHosts: parseAllowedHosts(process.env.RSS_ALLOWED_HOSTS) });
  return rssFetch;
}
