import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/site-url";
import { REPORT_SELECT, toReport, type ReportRow } from "./data";
import { renderReportPdf } from "./pdf";

const BUCKET = "reports";

export const pdfPathOf = (r: Pick<ReportRow, "orgId" | "id">) => `${r.orgId}/${r.id}.pdf`;

async function loadForDelivery(reportId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("reports")
    .select(`${REPORT_SELECT}, organizations(name, brand_primary, brand_accent)`)
    .eq("id", reportId)
    .single();
  if (error) throw new Error(`No se encontró el reporte: ${error.message}`);
  const org = (data as unknown as { organizations: { name: string; brand_primary: string; brand_accent: string } | null }).organizations;
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
    brand: { primary: org?.brand_primary ?? "#032a50", accent: org?.brand_accent ?? "#36c6c0" },
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

export type DeliveryResult = { status: "sent" | "skipped" | "not_configured" | "failed"; detail?: string; recipients: number };

/** Emails the approved report with its PDF attached and marks it as sent. */
export async function sendReport(reportId: string, recipients?: string[]): Promise<DeliveryResult> {
  const { path, bytes, report, orgName } = await storeReportPdf(reportId);
  const to = recipients ?? report.recipients;
  const admin = createAdminClient();
  let result: DeliveryResult;

  const key = process.env.RESEND_API_KEY;
  const from = process.env.REPORTS_FROM_EMAIL || process.env.ALERTS_FROM_EMAIL;
  if (!to.length) result = { status: "skipped", detail: "Sin destinatarios.", recipients: 0 };
  else if (!key || !from) result = { status: "not_configured", detail: "Faltan RESEND_API_KEY o ALERTS_FROM_EMAIL.", recipients: to.length };
  else {
    const { subject, html, text } = renderReportEmail(report, orgName, `${siteUrl()}/reportes/${report.id}`);
    try {
      const res = await fetch(`${process.env.RESEND_BASE_URL ?? "https://api.resend.com"}/emails`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to,
          subject,
          html,
          text,
          attachments: [{ filename: path.split("/").pop(), content: bytes.toString("base64") }],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      result = res.ok
        ? { status: "sent", recipients: to.length }
        : { status: "failed", detail: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}`, recipients: to.length };
    } catch (error) {
      result = { status: "failed", detail: error instanceof Error ? error.message : String(error), recipients: to.length };
    }
  }

  const delivery = { ...report.delivery, email: { ...result, at: new Date().toISOString(), to } };
  const { error } = await admin
    .from("reports")
    .update({
      delivery: delivery as never,
      ...(result.status === "sent" ? { status: "sent" as const, sent_at: new Date().toISOString() } : {}),
    })
    .eq("id", reportId);
  if (error) console.error("[reports] delivery:", error.message);
  return result;
}
