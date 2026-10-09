import { metaConnector } from "./meta.ts";
import { rssConnector } from "./rss.ts";
import type { Connector, SourceType } from "./types.ts";
import { xConnector } from "./x.ts";
import { youtubeConnector } from "./youtube.ts";

export const CONNECTORS: Record<SourceType, Connector<never>> = {
  meta: metaConnector as Connector<never>,
  rss: rssConnector as Connector<never>,
  youtube: youtubeConnector as Connector<never>,
  x: xConnector as Connector<never>,
};

export function getConnector(type: SourceType): Connector<unknown> {
  return CONNECTORS[type] as Connector<unknown>;
}

export * from "./types.ts";
