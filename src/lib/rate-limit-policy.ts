// Which /api/* routes are limited and how; pure so the proxy and tests share it.

export type RateLimitPolicy = { name: string; limit: number; windowSeconds: number; by: "user" | "ip" };

/**
 * Limits per /api/* route. Keys are the signed-in user when there is one, else
 * the client IP. Cron routes authorize with CRON_SECRET and are only called by
 * Vercel, so their limit just stops brute-forcing the secret.
 */
export function policyFor(pathname: string): RateLimitPolicy | null {
  if (!pathname.startsWith("/api/")) return null;
  if (pathname.startsWith("/api/asistente")) return { name: "assistant", limit: 20, windowSeconds: 60, by: "user" };
  if (pathname.startsWith("/api/errors")) return { name: "errors", limit: 30, windowSeconds: 60, by: "ip" };
  if (pathname.startsWith("/api/cron/")) return { name: "cron", limit: 30, windowSeconds: 60, by: "ip" };
  if (pathname.startsWith("/api/demo/")) return { name: "demo", limit: 120, windowSeconds: 60, by: "ip" };
  return { name: "api", limit: 60, windowSeconds: 60, by: "ip" };
}

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
