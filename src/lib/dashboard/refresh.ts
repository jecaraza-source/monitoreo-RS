import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Rebuilds the hourly rollup the dashboard reads (mention_stats_hourly).
 * Called by ingestion and classification after they write; a failure only
 * delays the dashboard, so it is logged, not thrown.
 */
export async function refreshMentionStats(admin: ReturnType<typeof createAdminClient>) {
  const { error } = await admin.rpc("refresh_mention_stats");
  if (error) console.error("[dashboard] refresh_mention_stats:", error.message);
}

/**
 * Applies pending corrections to the aggregates (rollup, "Lectura del día",
 * stale report drafts). Durable: the queue lives in the database
 * (stats_invalidations), so a failed call is retried by the next cron run.
 */
export async function processStatsInvalidations(admin: ReturnType<typeof createAdminClient>) {
  const { data, error } = await admin.rpc("process_stats_invalidations");
  if (error) console.error("[dashboard] process_stats_invalidations:", error.message);
  return (data ?? null) as { processed: number; busy?: boolean } | null;
}
