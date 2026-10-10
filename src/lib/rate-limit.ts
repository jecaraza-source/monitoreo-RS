import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RateLimitPolicy } from "./rate-limit-policy";

export { clientIp, policyFor, type RateLimitPolicy } from "./rate-limit-policy";

export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: Date | null };

/** Counts a hit in Postgres (shared by every instance). Fails open if the database is unreachable. */
export async function hitRateLimit(policy: RateLimitPolicy, subject: string): Promise<RateLimitResult> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { allowed: true, remaining: policy.limit, resetAt: null };
  try {
    const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
      p_key: `${policy.name}:${subject}`,
      p_limit: policy.limit,
      p_window_seconds: policy.windowSeconds,
    });
    if (error) throw new Error(error.message);
    const row = data?.[0];
    return row ? { allowed: row.allowed, remaining: row.remaining, resetAt: new Date(row.reset_at) } : { allowed: true, remaining: policy.limit, resetAt: null };
  } catch (error) {
    console.error("[rate-limit]", error instanceof Error ? error.message : error);
    return { allowed: true, remaining: policy.limit, resetAt: null };
  }
}
