import "server-only";
import { randomUUID } from "node:crypto";
import { runOutbox } from "@/lib/outbox/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { REPORT_SELECT, toReport, type ReportRow } from "./data";
import { loadLogo } from "@/lib/branding/logo";
import { renderReportPdf } from "./pdf";

const BUCKET = "reports";

export const pdfPathOf = (r: Pick<ReportRow, "orgId" | "id">) => `${r.orgId}/${r.id}.pdf`;

async function loadForDelivery(reportId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("reports")
    .select(`${REPORT_SELECT}, organizations(name, brand_primary, brand_accent, logo_path)`)
    .eq("id", reportId)
    .single();
  if (error) throw new Error(`No se encontró el reporte: ${error.message}`);
  const org = (data as unknown as { organizations: { name: string; brand_primary: string; brand_accent: string; logo_path: string | null } | null }).organizations;
  return { admin, report: toReport(data as never), org };
}

/** Renders the approved report to PDF and stores it in Storage (reports/<org>/<id>.pdf). */
export async function storeReportPdf(reportId: string): Promise<{ path: string; bytes: Buffer; report: ReportRow; orgName: string }> {
  const { admin, report, org } = await loadForDelivery(reportId);
  if (report.status === "draft") throw new Error("Aprueba el reporte antes de generar el PDF.");
  const bytes = await renderReportPdf({
    facts: report.facts,
    narrative: report.narrative,
    title: report.title,
    brand: { primary: org?.brand_primary ?? "#032a50", accent: org?.brand_accent ?? "#36c6c0", logo: await loadLogo(admin, org?.logo_path) },
  });
  const path = pdfPathOf(report);
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`No se pudo guardar el PDF: ${error.message}`);
  const { error: updateError } = await admin.from("reports").update({ pdf_path: path }).eq("id", reportId);
  if (updateError) throw new Error(`No se pudo registrar el PDF: ${updateError.message}`);
  return { path, bytes, report: { ...report, pdfPath: path }, orgName: org?.name ?? "" };
}

/** Short-lived download link (the bucket is private). */
export async function signedPdfUrl(path: string, seconds = 300): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, seconds, { download: true });
  return data?.signedUrl ?? null;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderReportEmail(report: ReportRow, orgName: string, url: string): { subject: string; html: string; text: string } {
  const subject = `${report.title} · ${orgName}`;
  const n = report.narrative;
  const text = `${n.headline}\n\n${n.executive_summary}\n\nEl reporte completo va adjunto en PDF.\nVer en Sigma Pulso: ${url}`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:600px">
<p style="margin:0 0 4px;color:#64748b;font-size:12px">${escape(orgName)} · ${escape(report.facts.period.label)}</p>
<h2 style="margin:0 0 12px;font-size:19px;color:#0f172a">${escape(n.headline)}</h2>
<p style="margin:0 0 16px;color:#334155;line-height:1.55">${escape(n.executive_summary)}</p>
<p style="margin:0 0 20px;color:#334155">El reporte completo va adjunto en PDF.</p>
<p style="margin:0 0 20px"><a href="${escape(url)}" style="background:#032a50;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Ver en Sigma Pulso</a></p>
<p style="margin:0;color:#94a3b8;font-size:12px">Documento de uso interno. Cifras de menciones públicas del periodo.</p>
</div>`;
  return { subject, html, text };
}

export type DeliveryResult = { status: "sent" | "skipped" | "not_configured" | "failed" | "queued"; detail?: string; recipients: number };

/**
 * Queues the report's emails in the outbox (one per recipient, one
 * idempotency key per send) and returns their combined state, marking the
 * report sent only when every email was accepted. p_nonce distinguishes a
 * person's re-send from the scheduled send.
 */
export async function queueReportEmails(admin: ReturnType<typeof createAdminClient>, report: ReportRow, to: string[], nonce: string): Promise<string[]> {
  const ids: string[] = [];
  for (const address of to) {
    const { data, error } = await admin.rpc("enqueue_outbox", {
      p_org_id: report.orgId,
      p_key: `report:${report.id}:${nonce}:${address.toLowerCase()}`,
      p_kind: "report",
      p_channel: "email",
      p_address: address,
      p_payload: { report_id: report.id, title: report.title },
      p_report_id: report.id,
    });
    if (error) throw new Error(`No se pudo encolar el correo: ${error.message}`);
    ids.push(data as string);
  }
  return ids;
}

/** Combined state of a send's outbox rows; marks the report sent (once) when all were accepted. */
export async function settleReportDelivery(reportId: string, outboxIds: string[], actorId?: string): Promise<DeliveryResult> {
  const admin = createAdminClient();
  const { data: rows } = await admin.from("outbox").select("id, address, status, provider_message_id, last_error").in("id", outboxIds);
  const list = rows ?? [];
  const sent = list.filter((r) => r.status === "sent");
  const failed = list.filter((r) => ["dead", "uncertain", "cancelled"].includes(r.status));
  const status: DeliveryResult["status"] = !list.length ? "skipped" : failed.length ? "failed" : sent.length === list.length ? "sent" : "queued";
  const detail = failed.length ? failed.map((r) => `${r.address}: ${r.last_error ?? r.status}`).join("; ").slice(0, 300) : undefined;
  const result: DeliveryResult = { status, detail, recipients: list.length };
  if (status === "queued") return result;

  const { data: current } = await admin.from("reports").select("delivery, status").eq("id", reportId).single();
  const email = { status, detail, recipients: list.length, at: new Date().toISOString(), to: list.map((r) => r.address), ids: sent.map((r) => r.provider_message_id) };
  const { error } = await admin
    .from("reports")
    .update({
      delivery: { ...((current?.delivery as object | null) ?? {}), email } as never,
      ...(status === "sent" && current?.status !== "sent" ? { status: "sent" as const, sent_at: new Date().toISOString() } : {}),
    })
    .eq("id", reportId);
  if (error) console.error("[reports] delivery:", error.message);
  const { data: org } = await admin.from("reports").select("org_id").eq("id", reportId).single();
  if (org) {
    const { error: auditError } = await admin.rpc("log_event", {
      p_org_id: org.org_id,
      p_action: "send",
      p_entity: "reports",
      p_entity_id: reportId,
      p_details: { to: email.to, status, ...(actorId ? { by: actorId } : {}) },
    });
    if (auditError) console.error("[audit] send:", auditError.message);
  }
  return result;
}

/** A person sends (or re-sends) the approved report: PDF, outbox, immediate dispatch. */
export async function sendReport(reportId: string, recipients?: string[], actorId?: string): Promise<DeliveryResult> {
  const { report } = await storeReportPdf(reportId);
  const to = recipients ?? report.recipients;
  if (!to.length) return { status: "skipped", detail: "Sin destinatarios.", recipients: 0 };
  if (!process.env.RESEND_API_KEY || !(process.env.REPORTS_FROM_EMAIL || process.env.ALERTS_FROM_EMAIL)) {
    return { status: "not_configured", detail: "Faltan RESEND_API_KEY o ALERTS_FROM_EMAIL.", recipients: to.length };
  }
  const admin = createAdminClient();
  const ids = await queueReportEmails(admin, report, to, `send-${randomUUID()}`);
  await runOutbox(admin, { budgetMs: 30_000, max: 40 });
  return settleReportDelivery(reportId, ids, actorId);
}
