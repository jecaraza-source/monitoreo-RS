// Rolling list of recent parent items (posts/videos) whose comments keep being
// polled after the item itself was ingested. Stored in sources.cursor.

export type RecentItem = { id: string; publishedAt: string };

export const RECENT_WINDOW_DAYS = 7;
export const MAX_RECENT = 20;

export function readRecent(cursor: Record<string, unknown>, key: string): RecentItem[] {
  const value = cursor[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is RecentItem => typeof v?.id === "string" && typeof v?.publishedAt === "string",
  );
}

/** Adds new items, drops those older than the window, keeps the newest MAX_RECENT. */
export function mergeRecent(previous: RecentItem[], added: RecentItem[], now: Date): RecentItem[] {
  const cutoff = now.getTime() - RECENT_WINDOW_DAYS * 86_400_000;
  const byId = new Map<string, RecentItem>();
  for (const item of [...previous, ...added]) byId.set(item.id, item);
  return [...byId.values()]
    .filter((item) => Date.parse(item.publishedAt) >= cutoff)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, MAX_RECENT);
}
