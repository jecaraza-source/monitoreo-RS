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
