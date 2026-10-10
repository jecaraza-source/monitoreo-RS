import type { Instrumentation } from "next";

/** Server errors (Server Components, Route Handlers, Server Actions, proxy) → app_errors + webhook. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recordError } = await import("@/lib/monitoring");
  await recordError({
    source: request.path.startsWith("/api/cron/") ? "cron" : "server",
    message: error instanceof Error ? error.message : String(error),
    digest: typeof error === "object" && error && "digest" in error ? String((error as { digest: unknown }).digest) : null,
    // Only the path and route; headers (cookies, tokens) are never stored.
    path: request.path.split("?")[0],
    context: { method: request.method, routePath: context.routePath, routeType: context.routeType },
  });
};
