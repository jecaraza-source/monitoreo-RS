// Feed bridge connector (unofficial): a feed that a self-hosted RSSHub or
// RSS-Bridge instance builds by scraping a social profile, channel or search
// (e.g. https://rsshub.example.mx/telegram/channel/canal). Read exactly like an
// RSS feed, through the same SSRF-safe fetch and RSS_ALLOWED_HOSTS allowlist,
// but nobody is vouched: the bridge says what the network shows, not who
// published it, so authors are never stored.
import { z } from "zod";
import { NETWORK_VALUES } from "./networks.ts";
import { rssConnector } from "./rss.ts";
import type { Connector } from "./types.ts";

export const rssBridgeConfigSchema = z.object({
  url: z.url("Escribe la URL del feed del puente.").refine((u) => /^https?:\/\//i.test(u), "La URL debe empezar con http(s)://"),
  network: z.enum(NETWORK_VALUES, "Elige la red que lee el puente."),
  requireMatch: z.boolean().optional(),
});
export type RssBridgeConfig = z.infer<typeof rssBridgeConfigSchema>;

export const rssBridgeConnector: Connector<RssBridgeConfig> = {
  type: "rss_bridge",
  label: "Puente RSS (no oficial)",
  enabled: true,
  official: false,
  requiresSecret: false,
  configSchema: rssBridgeConfigSchema,
  defaultRequireMatch: true,

  async fetchSince(source, since, ctx) {
    const result = await rssConnector.fetchSince(
      { id: source.id, cursor: source.cursor, config: { url: source.config.url, requireMatch: source.config.requireMatch } },
      since,
      ctx,
    );
    return { ...result, mentions: result.mentions.map((m) => ({ ...m, kind: "post" as const, author: null })) };
  },
};
