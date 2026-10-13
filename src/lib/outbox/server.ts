import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlertMessage } from "@/lib/notify/types";
import { renderReportEmail } from "@/lib/reports/deliver";
import { REPORT_SELECT, toReport } from "@/lib/reports/data";
import { siteUrl } from "@/lib/site-url";
import type { Database } from "@/lib/supabase/database.types";
import { dispatchOutbox, type DispatchSummary, type OutboxRow, type OutboxStore, type Rendered } from "./dispatch";
import { alertEmail, alertWhatsApp, caseEmail, caseWhatsApp, type CasePayload } from "./render";

type Admin = SupabaseClient<Database>;

/** A worker id per process run (the lease owner). */
export const workerId = (what: string) => `${what}-${process.env.VERCEL_REGION ?? "local"}-${randomUUID().slice(0, 8)}`;

export function supabaseStore(admin: Admin): OutboxStore {
  return {
    async claim(worker, limit, leaseSeconds) {
      const { data, error } = await admin.rpc("claim_outbox", { p_worker: worker, p_limit: limit, p_lease_seconds: leaseSeconds });
      if (error) throw new Error(`No se pudo leer el outbox: ${error.message}`);
      return (data ?? []) as unknown as OutboxRow[];
    },
    async complete(row, worker, outcome) {
      const { data, error } = await admin.rpc("complete_outbox", {
        p_id: row.id,
        p_worker: worker,
        p_attempt: row.attempts,
        p_ok: outcome.ok,
        p_provider_id: outcome.ok ? outcome.providerId : undefined,
        p_error: outcome.ok ? undefined : outcome.error,
        p_retryable: outcome.ok ? true : outcome.retryable,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
  };
}

/** Builds the message of a row; reports attach their stored PDF. */
export function rowRenderer(admin: Admin) {
  return async (row: OutboxRow): Promise<Rendered> => {
    const app = siteUrl();
    if (row.kind === "alert") {
      const message = row.payload as unknown as AlertMessage;
      return row.channel === "email" ? { channel: "email", email: alertEmail(message) } : { channel: "whatsapp", message: alertWhatsApp(message) };
    }
    if (row.kind === "report") {
      const { data, error } = await admin
        .from("reports")
        .select(`${REPORT_SELECT}, organizations(name)`)
        .eq("id", row.report_id ?? "")
        .single();
      if (error || !data) throw new Error(`No se encontró el reporte: ${error?.message ?? "sin datos"}`);
      const report = toReport(data as never);
      if (!report.pdfPath) throw new Error("El PDF del reporte aún no está guardado.");
      const { data: pdf, error: pdfError } = await admin.storage.from("reports").download(report.pdfPath);
      if (pdfError || !pdf) throw new Error(`No se pudo leer el PDF: ${pdfError?.message ?? "vacío"}`);
      const orgName = (data as unknown as { organizations: { name: string } | null }).organizations?.name ?? "";
      const email = renderReportEmail(report, orgName, `${app}/reportes/${report.id}`);
      return {
        channel: "email",
        email: {
          ...email,
          from: process.env.REPORTS_FROM_EMAIL || process.env.ALERTS_FROM_EMAIL,
          attachments: [{ filename: report.pdfPath.split("/").pop()!, content: Buffer.from(await pdf.arrayBuffer()).toString("base64") }],
        },
      };
    }
    const payload = row.payload as unknown as CasePayload;
    const kind = row.kind as "reminder" | "escalation" | "emergency";
    return row.channel === "email" ? { channel: "email", email: caseEmail(kind, payload, app) } : { channel: "whatsapp", message: caseWhatsApp(kind, payload, app) };
  };
}

/** Sends what is due (critical first), within a time budget. */
export async function runOutbox(admin: Admin, opts: { budgetMs?: number; max?: number } = {}): Promise<DispatchSummary> {
  const summary = await dispatchOutbox({
    store: supabaseStore(admin),
    render: rowRenderer(admin),
    worker: workerId("outbox"),
    env: process.env,
    fetch,
    budgetMs: opts.budgetMs ?? 60_000,
    max: opts.max ?? 200,
  });
  await settleAlerts(admin);
  return summary;
}

const DELIVERY: Record<string, "sent" | "failed" | "queued" | "skipped"> = {
  sent: "sent",
  dead: "failed",
  uncertain: "failed",
  cancelled: "skipped",
  pending: "queued",
  sending: "queued",
};

/** Mirrors the outbox outcome of recent alerts into alert_events.notifications (shown in /alertas). */
export async function settleAlerts(admin: Admin): Promise<void> {
  const since = new Date(Date.now() - 6 * 3_600_000).toISOString();
  const { data } = await admin
    .from("outbox")
    .select("alert_event_id, channel, status, last_error")
    .not("alert_event_id", "is", null)
    .gte("updated_at", since)
    .limit(1000);
  const byEvent = new Map<string, Map<string, { statuses: string[]; error?: string }>>();
  for (const r of data ?? []) {
    const channels = byEvent.get(r.alert_event_id!) ?? new Map();
    const c = channels.get(r.channel) ?? { statuses: [] };
    c.statuses.push(DELIVERY[r.status] ?? "queued");
    if (r.last_error) c.error = r.last_error;
    channels.set(r.channel, c);
    byEvent.set(r.alert_event_id!, channels);
  }
  for (const [eventId, channels] of byEvent) {
    const { data: event } = await admin.from("alert_events").select("notifications").eq("id", eventId).single();
    const notifications = { ...((event?.notifications as Record<string, unknown> | null) ?? {}) };
    for (const [channel, c] of channels) {
      const status = c.statuses.includes("queued") ? "queued" : c.statuses.includes("failed") ? "failed" : c.statuses.includes("sent") ? "sent" : "skipped";
      const failed = c.statuses.filter((s) => s === "failed").length;
      notifications[channel] = { status, ...(failed ? { detail: `${failed} de ${c.statuses.length} sin entregar.${c.error ? ` ${c.error}` : ""}`.slice(0, 300) } : {}) };
    }
    await admin.from("alert_events").update({ notifications: notifications as never }).eq("id", eventId);
  }
}
