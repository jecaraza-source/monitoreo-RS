/** ISO timestamp `ms` milliseconds ago (for "last N days" filters). */
export function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

export const DAY_MS = 86_400_000;
