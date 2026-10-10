import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { scrub } from "./scrub";

export type ErrorReport = {
  source: "server" | "client" | "cron";
  message: string;
  digest?: string | null;
  path?: string | null;
  context?: Record<string, unknown>;
  orgId?: string | null;
  userId?: string | null;
};

/**
 * Error monitoring without a third-party SDK: every error goes to the
 * app_errors table (admins read it in Configuración → Bitácora) and, when
 * ERROR_WEBHOOK_URL is set, to a Slack-compatible webhook. Never throws.
 */
export async function recordError(report: ErrorReport): Promise<void> {
  const message = scrub(report.message || "Error sin mensaje");
  console.error(`[${report.source}] ${report.path ?? ""} ${message}`);
  const tasks: Promise<unknown>[] = [];
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    tasks.push(
      Promise.resolve(
        createAdminClient()
          .from("app_errors")
          .insert({
            source: report.source,
            message,
            digest: report.digest ?? null,
            path: report.path?.slice(0, 500) ?? null,
            context: (report.context ?? {}) as never,
            org_id: report.orgId ?? null,
            user_id: report.userId ?? null,
          }),
      ),
    );
  }
  const webhook = process.env.ERROR_WEBHOOK_URL;
  if (webhook) {
    const env = process.env.VERCEL_ENV ?? "local";
    tasks.push(
      fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `⚠️ Sigma Pulso (${env}) · ${report.source} · ${report.path ?? ""}\n${message}${report.digest ? `\ndigest ${report.digest}` : ""}` }),
        signal: AbortSignal.timeout(3000),
      }),
    );
  }
  const results = await Promise.allSettled(tasks);
  for (const r of results) if (r.status === "rejected") console.error("[monitoring]", r.reason);
}
