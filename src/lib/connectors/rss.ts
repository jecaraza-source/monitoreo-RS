// RSS 2.0 / RSS 1.0 (RDF) / Atom connector for local media.
import { createHash } from "node:crypto";
import { z } from "zod";
import { fetchText } from "./http.ts";
import { feedFetch } from "./safe-fetch.ts";
import { clampText, decodeEntities, htmlToText, joinTitleAndBody } from "./text.ts";
import { ConnectorError, resolveContext, type Connector, type CoverageLimit, type NormalizedMention } from "./types.ts";

/** How far before the window an item may be dated and still be taken (late indexing, wrong feed dates). */
const LATE_TOLERANCE_MS = 7 * 86_400_000;

export const rssConfigSchema = z.object({
  url: z.url("Escribe la URL del feed.").refine((u) => /^https?:\/\//i.test(u), "La URL debe empezar con http(s)://"),
  /** Shown as the author of every item; defaults to the feed's own title. */
  outletName: z.string().trim().max(120).optional(),
  requireMatch: z.boolean().optional(),
});
export type RssConfig = z.infer<typeof rssConfigSchema>;

export type FeedItem = {
  id: string | null;
  link: string | null;
  title: string;
  body: string;
  publishedAt: Date | null;
  author: string | null;
};

export type ParsedFeed = { title: string; items: FeedItem[] };

function unwrap(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

/** Text of the first <tag>; tag may carry a namespace prefix (dc:creator, content:encoded). */
function tagText(xml: string, tag: string): string | null {
  const escaped = tag.replace(":", "\\:");
  const match = xml.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, "i"));
  return match ? unwrap(match[1]) : null;
}

function atomLink(xml: string): string | null {
  const links = [...xml.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1]);
  const pick = links.find((attrs) => /rel=["']alternate["']/i.test(attrs)) ?? links.find((attrs) => !/rel=/i.test(attrs));
  const href = pick?.match(/href=["']([^"']+)["']/i)?.[1];
  return href ? decodeEntities(href) : null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const time = Date.parse(value.trim());
  return Number.isNaN(time) ? null : new Date(time);
}

export function parseFeed(xml: string): ParsedFeed {
  if (!/<(rss|feed|rdf:RDF)\b/i.test(xml)) {
    throw new ConnectorError("La URL no devuelve un feed RSS o Atom.");
  }
  const firstItem = xml.search(/<(item|entry)\b/i);
  const head = firstItem === -1 ? xml : xml.slice(0, firstItem);
  const title = htmlToText(tagText(head, "title") ?? "");

  const items: FeedItem[] = [];
  for (const match of xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const block = match[2];
    const isAtom = match[1].toLowerCase() === "entry";
    const rawLink = isAtom ? atomLink(block) : (tagText(block, "link") ?? atomLink(block));
    items.push({
      id: tagText(block, "guid") ?? tagText(block, "id"),
      link: rawLink ? decodeEntities(rawLink).trim() || null : null,
      title: htmlToText(tagText(block, "title") ?? ""),
      body: htmlToText(
        tagText(block, "content:encoded") ?? tagText(block, "description") ?? tagText(block, "summary") ?? tagText(block, "content") ?? "",
      ),
      publishedAt: parseDate(
        tagText(block, "pubDate") ?? tagText(block, "published") ?? tagText(block, "dc:date") ?? tagText(block, "updated"),
      ),
      author: (() => {
        const raw = tagText(block, "dc:creator") ?? tagText(block, "name") ?? tagText(block, "author");
        return raw ? htmlToText(raw) || null : null;
      })(),
    });
  }
  return { title, items };
}

/** Item links are shown as anchors: only http(s) survives (no javascript:, data:…). */
function webLink(link: string | null): string | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function externalIdOf(item: FeedItem): string {
  const id = item.id ? decodeEntities(item.id).trim() : "";
  if (id) return id.slice(0, 500);
  if (item.link) return item.link.slice(0, 500);
  // No guid and no link: hash what identifies the item.
  return `sha1:${createHash("sha1").update(`${item.title}|${item.publishedAt?.toISOString() ?? ""}`).digest("hex")}`;
}

export const rssConnector: Connector<RssConfig> = {
  type: "rss",
  label: "RSS / Atom",
  enabled: true,
  official: true,
  requiresSecret: false,
  configSchema: rssConfigSchema,
  defaultRequireMatch: true,

  async fetchSince(source, since, ctxInput) {
    // Feed URLs are typed by users: the default fetch refuses internal destinations.
    const ctx = resolveContext({ ...ctxInput, fetch: ctxInput?.fetch ?? feedFetch() });
    const { status, text } = await fetchText(ctx.fetch, source.config.url, {
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
      signal: ctx.signal,
    });
    if (status >= 400) throw new ConnectorError(`El feed respondió HTTP ${status}.`);
    const feed = parseFeed(text);

    const host = new URL(source.config.url).hostname.replace(/^www\./, "");
    const outlet = source.config.outletName || feed.title || host;
    const now = ctx.now();
    // A feed is a window of its latest items: there is nothing to paginate.
    // Items published before the window but indexed late are still taken
    // within LATE_TOLERANCE (dedupe makes re-reading them harmless).
    const floor = since.getTime() - LATE_TOLERANCE_MS;

    const mentions: NormalizedMention[] = [];
    let oldestDated: number | null = null;
    for (const item of feed.items) {
      if (item.publishedAt) oldestDated = Math.min(oldestDated ?? Infinity, item.publishedAt.getTime());
      // Items without a date are kept (dedupe makes re-reading them harmless).
      if (item.publishedAt && item.publishedAt.getTime() <= floor) continue;
      const text = clampText(joinTitleAndBody(item.title, item.body));
      if (!text) continue;
      mentions.push({
        externalId: externalIdOf(item),
        url: webLink(item.link),
        text,
        publishedAt: (item.publishedAt && item.publishedAt < now ? item.publishedAt : now).toISOString(),
        kind: "article",
        author: { platform: "rss", handle: host, displayName: outlet, followers: null, kind: "media", vouched: true },
        metrics: {},
      });
    }

    const limits: CoverageLimit[] = [];
    let gap: { from: string; to: string } | undefined;
    // Even the oldest item of the feed is newer than the window start: the
    // feed rolled past items published in between, and a feed cannot return them.
    if (oldestDated !== null && oldestDated > since.getTime()) {
      gap = { from: since.toISOString(), to: new Date(oldestDated).toISOString() };
      limits.push({
        kind: "feed_window",
        detail: `El feed sólo conserva sus ${feed.items.length} notas más recientes; pudo haber notas entre ${gap.from} y ${gap.to} que ya no publica.`,
      });
    }
    if (mentions.length > ctx.limit) {
      limits.push({ kind: "items", detail: `Vista previa: ${ctx.limit} de ${mentions.length} notas.` });
      return { mentions: mentions.slice(0, ctx.limit), complete: false, limits, gap };
    }
    return { mentions, complete: true, limits, gap };
  },
};
