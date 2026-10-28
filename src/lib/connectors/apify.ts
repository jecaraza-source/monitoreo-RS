// Apify connector (unofficial): reads the dataset of the latest successful run
// of a saved Apify task (an actor that scrapes a network, with its input and
// schedule set up in Apify). Running and scheduling the scraper stays in
// Apify; this connector only reads results with the server's APIFY_TOKEN.
// Actors name their fields differently, so the common ones are mapped; authors
// are never stored (a scraper cannot prove who an account is).
import { createHash } from "node:crypto";
import { z } from "zod";
import { fetchJson } from "./http.ts";
import { NETWORK_VALUES } from "./networks.ts";
import { clampText, htmlToText } from "./text.ts";
import { ConnectorError, resolveContext, type Connector, type CoverageLimit, type NormalizedMention } from "./types.ts";

const API = "https://api.apify.com";
/** Same tolerance as RSS: items dated a little before the window are still taken (dedupe makes it harmless). */
const LATE_TOLERANCE_MS = 7 * 86_400_000;
/** A task whose last successful run is older than this is probably no longer scheduled. */
const STALE_MS = 2 * 86_400_000;
const MAX_ITEMS = 1000;

export const apifyConfigSchema = z.object({
  // "usuario~nombre-de-tarea" or the task id; "usuario/nombre" (as Apify shows it) is accepted too.
  task: z
    .string()
    .trim()
    .transform((v) => v.replace("/", "~"))
    .refine((v) => /^[A-Za-z0-9][A-Za-z0-9._-]{1,99}(~[A-Za-z0-9._-]{1,100})?$/.test(v), "Escribe la tarea como usuario~nombre-de-tarea o su ID."),
  network: z.enum(NETWORK_VALUES, "Elige la red que lee la tarea."),
  requireMatch: z.boolean().optional(),
});
export type ApifyConfig = z.infer<typeof apifyConfigSchema>;

type Run = { data?: { id?: string; status?: string; finishedAt?: string; defaultDatasetId?: string }; error?: { type?: string; message?: string } };
type Item = Record<string, unknown>;

const first = (item: Item, keys: string[]): unknown => keys.map((k) => item[k]).find((v) => v !== undefined && v !== null && v !== "");
const text = (item: Item, keys: string[]): string | null => {
  const v = first(item, keys);
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
};
const count = (item: Item, keys: string[]): number | undefined => {
  const v = keys.map((k) => item[k]).find((x) => typeof x === "number" && Number.isFinite(x));
  return typeof v === "number" ? Math.max(0, Math.round(v)) : undefined;
};

/** ISO strings, Twitter-style dates and epoch seconds or milliseconds. */
export function itemDate(item: Item): Date | null {
  const v = first(item, ["timestamp", "createdAt", "createTimeISO", "createTime", "created_time", "time", "date", "publishedAt", "postedAt", "taken_at_timestamp"]);
  let time: number;
  if (typeof v === "number" || (typeof v === "string" && /^\d{9,13}$/.test(v))) {
    const n = Number(v);
    time = n < 1e11 ? n * 1000 : n;
  } else if (typeof v === "string") time = Date.parse(v);
  else return null;
  return Number.isFinite(time) && time > 0 ? new Date(time) : null;
}

function webLink(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function toMention(item: Item, now: Date): NormalizedMention | null {
  const body = text(item, ["text", "fullText", "full_text", "caption", "content", "message", "description", "title"]);
  const clean = body ? clampText(htmlToText(body)) : "";
  if (!clean) return null;
  const url = webLink(text(item, ["url", "postUrl", "webVideoUrl", "link", "permalink", "twitterUrl"]));
  const id = text(item, ["id", "postId", "tweetId", "shortCode", "messageId"]);
  const date = itemDate(item);
  return {
    externalId: (id ? `id:${id}` : url ?? `sha1:${createHash("sha1").update(clean).digest("hex")}`).slice(0, 500),
    url,
    text: clean,
    publishedAt: (date && date < now ? date : now).toISOString(),
    kind: "post",
    author: null,
    metrics: Object.fromEntries(
      Object.entries({
        likes: count(item, ["likesCount", "likeCount", "likes", "diggCount", "reactionsCount", "favoriteCount"]),
        comments: count(item, ["commentsCount", "commentCount", "comments", "replyCount"]),
        shares: count(item, ["sharesCount", "shareCount", "shares", "retweetCount", "forwards"]),
        views: count(item, ["viewCount", "playCount", "views", "videoViewCount", "videoPlayCount"]),
      }).filter(([, v]) => v !== undefined),
    ),
  };
}

export const apifyConnector: Connector<ApifyConfig> = {
  type: "apify",
  label: "Apify (no oficial)",
  enabled: true,
  official: false,
  requiresSecret: false,
  configSchema: apifyConfigSchema,
  defaultRequireMatch: true,

  async fetchSince(source, since, ctxInput) {
    const ctx = resolveContext(ctxInput);
    if (!ctx.env.apifyToken) throw new ConnectorError("Falta configurar APIFY_TOKEN en el servidor.");
    const api = (ctx.env.apifyApiUrl || API).replace(/\/$/, "");
    const headers = { authorization: `Bearer ${ctx.env.apifyToken}` };
    const task = encodeURIComponent(source.config.task);

    const run = await fetchJson<Run>(ctx.fetch, `${api}/v2/actor-tasks/${task}/runs/last?status=SUCCEEDED`, { headers, signal: ctx.signal });
    if (run.status === 401 || run.status === 403) throw new ConnectorError("Apify rechazó APIFY_TOKEN o no da acceso a la tarea.");
    if (run.status === 404) throw new ConnectorError(`La tarea ${source.config.task} no existe en Apify o aún no tiene corridas exitosas.`);
    if (run.status === 429) throw new ConnectorError("Apify limitó las consultas; se reintentará más tarde.");
    if (run.status >= 400 || !run.body.data?.defaultDatasetId) {
      throw new ConnectorError(`Apify respondió: ${run.body.error?.message ?? `HTTP ${run.status}`}`);
    }

    const dataset = encodeURIComponent(run.body.data.defaultDatasetId);
    const items = await fetchJson<Item[] | { error?: { message?: string } }>(
      ctx.fetch,
      `${api}/v2/datasets/${dataset}/items?clean=true&format=json&limit=${MAX_ITEMS}`,
      { headers, signal: ctx.signal },
    );
    if (items.status >= 400 || !Array.isArray(items.body)) {
      throw new ConnectorError(`Apify respondió: ${(!Array.isArray(items.body) && items.body.error?.message) || `HTTP ${items.status}`}`);
    }

    const now = ctx.now();
    const until = (ctx.until ?? now).getTime();
    const floor = since.getTime() - LATE_TOLERANCE_MS;
    const limits: CoverageLimit[] = [];
    const finished = Date.parse(run.body.data.finishedAt ?? "");
    if (Number.isFinite(finished) && now.getTime() - finished > STALE_MS) {
      const days = Math.floor((now.getTime() - finished) / 86_400_000);
      limits.push({ kind: "feed_window", detail: `La última corrida exitosa de la tarea terminó hace ${days} días; revisa su programación en Apify.` });
    }

    const mentions: NormalizedMention[] = [];
    let oldestDated: number | null = null;
    for (const item of items.body) {
      if (!item || typeof item !== "object") continue;
      const date = itemDate(item);
      if (date) oldestDated = Math.min(oldestDated ?? Infinity, date.getTime());
      // Newer than the window end: left for the run that covers it.
      if (date && (date.getTime() <= floor || date.getTime() > until)) continue;
      const mention = toMention(item, now);
      if (mention) mentions.push(mention);
    }

    // Like a feed, a scraper run returns the latest items only: even its oldest
    // item is newer than the window start, so what it rolled past is reported, not retried.
    let gap: { from: string; to: string } | undefined;
    if (oldestDated !== null && oldestDated > since.getTime()) {
      gap = { from: since.toISOString(), to: new Date(oldestDated).toISOString() };
      limits.push({
        kind: "feed_window",
        detail: `La corrida sólo trae sus ${items.body.length} publicaciones más recientes; pudo haber publicaciones entre ${gap.from} y ${gap.to} que no leyó.`,
      });
    }
    if (mentions.length > ctx.limit) {
      limits.push({ kind: "items", detail: `Vista previa: ${ctx.limit} de ${mentions.length} publicaciones.` });
      return { mentions: mentions.slice(0, ctx.limit), complete: false, limits, gap };
    }
    return { mentions, complete: true, limits, gap };
  },
};
