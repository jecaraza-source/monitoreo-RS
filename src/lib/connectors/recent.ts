// Rolling list of recent parent items (posts/videos) whose comments keep being
// polled after the item itself was ingested. Stored in sources.cursor, with
// each parent's comment progress (Facebook: paging cursor; YouTube: watermark).

export type RecentItem = {
  id: string;
  publishedAt: string;
  /** Facebook: `after` cursor of the last comment page read (comments are read oldest first). */
  after?: string;
  /** YouTube: comments up to this instant were read (comments are listed newest first). */
  commentsUntil?: string;
};

export const RECENT_WINDOW_DAYS = 7;
export const MAX_RECENT = 50;

export function readRecent(cursor: Record<string, unknown>, key: string): RecentItem[] {
  const value = cursor[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is RecentItem => typeof v?.id === "string" && typeof v?.publishedAt === "string",
  );
}

/**
 * Adds new items (keeping the comment progress of known ones), drops those
 * older than the window and keeps the newest MAX_RECENT. `dropped` counts
 * items still inside the window that did not fit: their comments stop being
 * polled, which the run reports.
 */
export function mergeRecent(previous: RecentItem[], added: RecentItem[], now: Date): { items: RecentItem[]; dropped: number } {
  const cutoff = now.getTime() - RECENT_WINDOW_DAYS * 86_400_000;
  const byId = new Map<string, RecentItem>();
  for (const item of previous) byId.set(item.id, item);
  for (const item of added) byId.set(item.id, { ...item, ...byId.get(item.id) });
  const inWindow = [...byId.values()]
    .filter((item) => Date.parse(item.publishedAt) >= cutoff)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return { items: inWindow.slice(0, MAX_RECENT), dropped: Math.max(0, inWindow.length - MAX_RECENT) };
}
