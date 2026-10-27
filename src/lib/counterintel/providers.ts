// Radar Social verification services. Each one answers about an indicator
// (domain, URL, claim, news topic), never about a person. Parsing is pure and
// unit-tested; requests go to fixed provider hosts (only the query varies), with
// a timeout and a size cap. RADAR_<PROVIDER>_URL overrides a base URL for tests.
import { readCapped } from "../connectors/http.ts";

export const PROVIDERS = ["urlhaus", "phishstats", "safe_browsing", "crtsh", "factcheck", "gdelt"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_LABELS: Record<Provider, string> = {
  urlhaus: "URLhaus (abuse.ch)",
  phishstats: "PhishStats",
  safe_browsing: "Google Safe Browsing",
  crtsh: "Certificados públicos (crt.sh)",
  factcheck: "Google Fact Check",
  gdelt: "GDELT (medios)",
};

export type CheckStatus = "flagged" | "clear" | "found" | "skipped" | "error";

export type CheckResult = {
  provider: Provider;
  subject: string;
  status: CheckStatus;
  summary: string;
  details: Record<string, unknown>;
};

export type ProviderEnv = {
  abuseChKey?: string;
  safeBrowsingKey?: string;
  factCheckKey?: string;
  base?: Partial<Record<Provider, string>>;
};

const DEFAULT_BASE: Record<Provider, string> = {
  urlhaus: "https://urlhaus-api.abuse.ch/v1",
  phishstats: "https://api.phishstats.info/api",
  safe_browsing: "https://safebrowsing.googleapis.com/v4",
  crtsh: "https://crt.sh",
  factcheck: "https://factchecktools.googleapis.com/v1alpha1",
  gdelt: "https://api.gdeltproject.org/api/v2",
};

export function providerEnv(env: Record<string, string | undefined> = process.env): ProviderEnv {
  const base: Partial<Record<Provider, string>> = {};
  for (const p of PROVIDERS) {
    const value = env[`RADAR_${p.toUpperCase()}_URL`];
    if (value) base[p] = value.replace(/\/$/, "");
  }
  return {
    abuseChKey: env.ABUSECH_AUTH_KEY || undefined,
    safeBrowsingKey: env.GOOGLE_SAFE_BROWSING_API_KEY || undefined,
    factCheckKey: env.GOOGLE_FACTCHECK_API_KEY || undefined,
    base,
  };
}

const baseOf = (env: ProviderEnv, p: Provider) => env.base?.[p] ?? DEFAULT_BASE[p];

// ---------------------------------------------------------------------------
// Indicators and domains (pure)
// ---------------------------------------------------------------------------

const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export type IndicatorTarget = { kind: "url" | "domain"; host: string; url: string | null };

/** What a service can check in an indicator: a URL (and its host) or a bare domain. Handles and hashtags: null. */
export function indicatorTarget(indicator: string): IndicatorTarget | null {
  const text = indicator.trim();
  if (!text || text.startsWith("@") || text.startsWith("#")) return null;
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      return DOMAIN.test(host) ? { kind: "url", host, url: url.toString() } : null;
    } catch {
      return null;
    }
  }
  const host = text.toLowerCase().replace(/^www\./, "").replace(/\/.*$/, "");
  return DOMAIN.test(host) ? { kind: "domain", host, url: null } : null;
}

export function isOfficial(host: string, officialDomains: readonly string[]): boolean {
  const h = host.toLowerCase();
  return officialDomains.some((d) => h === d || h.endsWith(`.${d}`));
}

export type Lookalike = { domain: string; firstSeen: string; issuer: string | null; term: string };

/**
 * Domains from certificate transparency entries that contain a watch term and
 * are not official (nor subdomains of an official domain). Wildcards are
 * reduced to their base; each domain keeps its earliest certificate.
 */
export function lookalikesFrom(entries: unknown, terms: readonly string[], officialDomains: readonly string[], limit = 100): Lookalike[] {
  if (!Array.isArray(entries)) return [];
  const byDomain = new Map<string, Lookalike>();
  for (const raw of entries as Record<string, unknown>[]) {
    const names = `${raw?.name_value ?? ""}\n${raw?.common_name ?? ""}`.split(/\s+/);
    const seen = typeof raw?.not_before === "string" ? raw.not_before : typeof raw?.entry_timestamp === "string" ? raw.entry_timestamp : "";
    const issuer = typeof raw?.issuer_name === "string" ? (/O=([^,]+)/.exec(raw.issuer_name)?.[1] ?? raw.issuer_name) : null;
    for (const name of names) {
      const domain = name.toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
      if (!DOMAIN.test(domain) || isOfficial(domain, officialDomains)) continue;
      const term = terms.find((t) => domain.includes(t));
      if (!term) continue;
      const prev = byDomain.get(domain);
      if (!prev || (seen && seen < prev.firstSeen)) byDomain.set(domain, { domain, firstSeen: seen, issuer, term });
    }
  }
  return [...byDomain.values()].sort((a, b) => b.firstSeen.localeCompare(a.firstSeen)).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Response parsers (pure)
// ---------------------------------------------------------------------------

const str = (v: unknown) => (typeof v === "string" ? v : null);
const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

export function parseUrlhaus(subject: string, raw: unknown): CheckResult {
  const data = (raw ?? {}) as Record<string, unknown>;
  const urls = arr(data.urls).slice(0, 10).map((u) => ({ url: str(u.url), status: str(u.url_status), threat: str(u.threat), added: str(u.date_added) }));
  if (data.query_status === "ok" && urls.length > 0) {
    const online = urls.filter((u) => u.status === "online").length;
    return { provider: "urlhaus", subject, status: "flagged", summary: `Listado con ${Number(data.urls_count ?? urls.length)} URL maliciosas${online ? ` (${online} en línea)` : ""}.`, details: { urls } };
  }
  if (data.query_status === "no_results" || data.query_status === "ok") {
    return { provider: "urlhaus", subject, status: "clear", summary: "No aparece en URLhaus.", details: {} };
  }
  return { provider: "urlhaus", subject, status: "error", summary: `URLhaus respondió: ${String(data.query_status ?? "sin estado")}.`, details: {} };
}

export function parsePhishstats(subject: string, raw: unknown): CheckResult {
  const rows = arr(raw).slice(0, 10).map((r) => ({ url: str(r.url), title: str(r.title), date: str(r.date), score: r.score ?? null }));
  return rows.length
    ? { provider: "phishstats", subject, status: "flagged", summary: `${rows.length} reporte${rows.length === 1 ? "" : "s"} de phishing.`, details: { rows } }
    : { provider: "phishstats", subject, status: "clear", summary: "No aparece en PhishStats.", details: {} };
}

export function parseSafeBrowsing(subject: string, raw: unknown): CheckResult {
  const matches = arr((raw as Record<string, unknown> | null)?.matches).map((m) => str(m.threatType)).filter(Boolean) as string[];
  return matches.length
    ? { provider: "safe_browsing", subject, status: "flagged", summary: `Marcado por Google: ${[...new Set(matches)].join(", ")}.`, details: { threats: [...new Set(matches)] } }
    : { provider: "safe_browsing", subject, status: "clear", summary: "Google no lo marca como peligroso.", details: {} };
}

export type FactCheckItem = { claim: string; claimant: string | null; rating: string | null; publisher: string | null; url: string | null; date: string | null };

export function parseFactCheck(subject: string, raw: unknown): CheckResult {
  const items: FactCheckItem[] = arr((raw as Record<string, unknown> | null)?.claims).slice(0, 20).map((c) => {
    const review = arr(c.claimReview)[0] ?? {};
    return {
      claim: str(c.text) ?? "",
      claimant: str(c.claimant),
      rating: str(review.textualRating),
      publisher: str((review.publisher as Record<string, unknown> | undefined)?.name),
      url: str(review.url),
      date: str(review.reviewDate) ?? str(c.claimDate),
    };
  });
  return items.length
    ? { provider: "factcheck", subject, status: "found", summary: `${items.length} verificación${items.length === 1 ? "" : "es"} publicada${items.length === 1 ? "" : "s"}.`, details: { items } }
    : { provider: "factcheck", subject, status: "clear", summary: "Sin verificaciones publicadas.", details: {} };
}

export type NewsItem = { title: string; url: string; domain: string | null; date: string | null; country: string | null };

/** GDELT seendate "20261027T120000Z" → ISO. */
export function gdeltDate(value: unknown): string | null {
  const m = typeof value === "string" ? /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

export function parseGdelt(subject: string, raw: unknown): CheckResult {
  const items: NewsItem[] = arr((raw as Record<string, unknown> | null)?.articles)
    .filter((a) => str(a.url) && str(a.title))
    .slice(0, 50)
    .map((a) => ({ title: str(a.title)!, url: str(a.url)!, domain: str(a.domain), date: gdeltDate(a.seendate), country: str(a.sourcecountry) }));
  return items.length
    ? { provider: "gdelt", subject, status: "found", summary: `${items.length} nota${items.length === 1 ? "" : "s"} en medios.`, details: { items } }
    : { provider: "gdelt", subject, status: "clear", summary: "Sin notas en medios en los últimos 7 días.", details: {} };
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

type Fetch = typeof fetch;
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 5 * 1024 * 1024;

async function requestJson(fetchImpl: Fetch, url: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<unknown> {
  const signal = AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(url, { ...init, signal, redirect: "error", headers: { accept: "application/json", ...init.headers } });
  const text = await readCapped(response, MAX_BYTES, signal);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return text.trim() ? JSON.parse(text) : null;
}

const skipped = (provider: Provider, subject: string, what: string): CheckResult => ({
  provider,
  subject,
  status: "skipped",
  summary: `Sin configurar: falta ${what} en el servidor.`,
  details: {},
});

const failed = (provider: Provider, subject: string, error: unknown): CheckResult => ({
  provider,
  subject,
  status: "error",
  summary: `${PROVIDER_LABELS[provider]} no respondió${error instanceof Error && /^HTTP \d+$/.test(error.message) ? ` (${error.message})` : ""}.`,
  details: {},
});

async function guarded(provider: Provider, subject: string, run: () => Promise<CheckResult>): Promise<CheckResult> {
  try {
    return await run();
  } catch (error) {
    return failed(provider, subject, error);
  }
}

export function checkUrlhaus(host: string, env: ProviderEnv, fetchImpl: Fetch = fetch): Promise<CheckResult> {
  if (!env.abuseChKey) return Promise.resolve(skipped("urlhaus", host, "ABUSECH_AUTH_KEY"));
  return guarded("urlhaus", host, async () =>
    parseUrlhaus(host, await requestJson(fetchImpl, `${baseOf(env, "urlhaus")}/host/`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "Auth-Key": env.abuseChKey! },
      body: new URLSearchParams({ host }).toString(),
    })),
  );
}

export function checkPhishstats(host: string, env: ProviderEnv, fetchImpl: Fetch = fetch): Promise<CheckResult> {
  const url = `${baseOf(env, "phishstats")}/phishing?_where=${encodeURIComponent(`(url,like,~${host}~)`)}&_sort=-id&_size=10`;
  return guarded("phishstats", host, async () => parsePhishstats(host, await requestJson(fetchImpl, url)));
}

export function checkSafeBrowsing(target: string, env: ProviderEnv, fetchImpl: Fetch = fetch): Promise<CheckResult> {
  if (!env.safeBrowsingKey) return Promise.resolve(skipped("safe_browsing", target, "GOOGLE_SAFE_BROWSING_API_KEY"));
  const url = `${baseOf(env, "safe_browsing")}/threatMatches:find?key=${encodeURIComponent(env.safeBrowsingKey)}`;
  const body = {
    client: { clientId: "sigma-pulso", clientVersion: "1.0" },
    threatInfo: {
      threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
      platformTypes: ["ANY_PLATFORM"],
      threatEntryTypes: ["URL"],
      threatEntries: [{ url: target }],
    },
  };
  return guarded("safe_browsing", target, async () =>
    parseSafeBrowsing(target, await requestJson(fetchImpl, url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })),
  );
}

export function searchCertificates(term: string, officialDomains: readonly string[], env: ProviderEnv, fetchImpl: Fetch = fetch): Promise<CheckResult> {
  const url = `${baseOf(env, "crtsh")}/?q=${encodeURIComponent(`%${term}%`)}&output=json&exclude=expired`;
  return guarded("crtsh", term, async () => {
    const found = lookalikesFrom(await requestJson(fetchImpl, url, {}, 30_000), [term], officialDomains);
    return found.length
      ? { provider: "crtsh", subject: term, status: "found", summary: `${found.length} dominio${found.length === 1 ? "" : "s"} con «${term}» fuera de los oficiales.`, details: { domains: found } }
      : { provider: "crtsh", subject: term, status: "clear", summary: `Ningún certificado vigente con «${term}» fuera de los dominios oficiales.`, details: {} };
  });
}

export function searchFactChecks(query: string, env: ProviderEnv, fetchImpl: Fetch = fetch): Promise<CheckResult> {
  if (!env.factCheckKey) return Promise.resolve(skipped("factcheck", query, "GOOGLE_FACTCHECK_API_KEY"));
  const url = `${baseOf(env, "factcheck")}/claims:search?query=${encodeURIComponent(query)}&languageCode=es&pageSize=20&key=${encodeURIComponent(env.factCheckKey)}`;
  return guarded("factcheck", query, async () => parseFactCheck(query, await requestJson(fetchImpl, url)));
}

export function searchNews(query: string, env: ProviderEnv, fetchImpl: Fetch = fetch): Promise<CheckResult> {
  const q = `${query} sourcelang:spanish`;
  const url = `${baseOf(env, "gdelt")}/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=50&timespan=7d&sort=datedesc`;
  return guarded("gdelt", query, async () => parseGdelt(query, await requestJson(fetchImpl, url)));
}

/** Every applicable check for one indicator: reputation of its host, and Safe Browsing on the URL (or the host). */
export async function checkIndicator(indicator: string, env: ProviderEnv, fetchImpl: Fetch = fetch): Promise<CheckResult[]> {
  const target = indicatorTarget(indicator);
  if (!target) return [];
  return Promise.all([
    checkUrlhaus(target.host, env, fetchImpl),
    checkPhishstats(target.host, env, fetchImpl),
    checkSafeBrowsing(target.url ?? `http://${target.host}/`, env, fetchImpl),
  ]);
}
