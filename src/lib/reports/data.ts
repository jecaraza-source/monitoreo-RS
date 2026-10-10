import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallRecord } from "@/lib/ai/classifier";
import { buildReportFacts, generateNarrative, NarrativeError, peakBuckets, readTargets, type Narrative, type ReportExtras, type ReportFacts } from "@/lib/ai/narrative";
import { parseDashboard } from "@/lib/dashboard/model";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/database.types";
import { reportPeriod, type ReportKind, type ReportPeriod } from "./period";

type Client = SupabaseClient<Database>;

export type ReportStatus = Database["public"]["Enums"]["report_status"];

export type ReportRow = {
  id: string;
  orgId: string;
  kind: ReportKind;
  status: ReportStatus;
  title: string;
  startDay: string;
  endDay: string;
  facts: ReportFacts;
  narrative: Narrative;
  recipients: string[];
  pdfPath: string | null;
  model: string | null;
  createdAt: string;
  approvedAt: string | null;
  sentAt: string | null;
  delivery: Record<string, unknown>;
};

export const REPORT_SELECT =
  "id, org_id, period, status, title, period_start, period_end, facts, content, recipients, pdf_path, model, created_at, approved_at, sent_at, delivery";

type Raw = {
  id: string;
  org_id: string;
  period: ReportKind;
  status: ReportStatus;
  title: string;
  period_start: string;
  period_end: string;
  facts: Json;
  content: Json;
  recipients: string[];
  pdf_path: string | null;
  model: string | null;
  created_at: string;
  approved_at: string | null;
  sent_at: string | null;
  delivery: Json;
};

export function toReport(r: Raw): ReportRow {
  return {
    id: r.id,
    orgId: r.org_id,
    kind: r.period,
    status: r.status,
    title: r.title,
    startDay: r.period_start,
    endDay: r.period_end,
    facts: r.facts as unknown as ReportFacts,
    narrative: r.content as unknown as Narrative,
    recipients: r.recipients ?? [],
    pdfPath: r.pdf_path,
    model: r.model,
    createdAt: r.created_at,
    approvedAt: r.approved_at,
    sentAt: r.sent_at,
    delivery: (r.delivery ?? {}) as Record<string, unknown>,
  };
}

/** Aggregates the period into ReportFacts. Works with the user's session (RLS) or the service role (cron). */
export async function loadReportFacts(client: Client, orgId: string, period: ReportPeriod): Promise<ReportFacts> {
  const [org, current, previous, departments, projects] = await Promise.all([
    client.from("organizations").select("name, state").eq("id", orgId).single(),
    client.rpc("dashboard_stats", {
      p_org_id: orgId,
      p_from: period.from.toISOString(),
      p_to: period.to.toISOString(),
      p_bucket: period.bucket,
      p_detail: true,
    }),
    client.rpc("dashboard_stats", {
      p_org_id: orgId,
      p_from: period.prevFrom.toISOString(),
      p_to: period.prevTo.toISOString(),
      p_bucket: period.bucket,
      p_detail: false,
    }),
    client.from("departments").select("id, name").eq("org_id", orgId),
    client.from("projects").select("kpis").eq("org_id", orgId),
  ]);
  if (org.error) throw new Error(`No se pudo leer el municipio: ${org.error.message}`);
  if (current.error) throw new Error(`No se pudieron calcular las cifras: ${current.error.message}`);

  const dashboard = parseDashboard(
    (current.data ?? {}) as Record<string, unknown>,
    (previous.data ?? {}) as Record<string, unknown>,
    new Map((departments.data ?? []).map((d) => [d.id, d.name])),
  );
  // Only the departments' NSS ranking is capped at 8 by parseDashboard; keep it.
  const peaks = peakBuckets(dashboard.series, 3);
  const extras = await client.rpc("report_extras", {
    p_org_id: orgId,
    p_from: period.from.toISOString(),
    p_to: period.to.toISOString(),
    p_peaks: peaks.map((p) => p.start),
    p_bucket: period.bucket,
  });
  if (extras.error) throw new Error(`No se pudieron calcular las cifras: ${extras.error.message}`);

  const seen = new Set<string>();
  const targets = (projects.data ?? [])
    .flatMap((p) => readTargets(p.kpis))
    .filter((t) => (seen.has(t.label) ? false : (seen.add(t.label), true)));

  return buildReportFacts({
    municipality: org.data.name,
    state: org.data.state,
    period,
    dashboard,
    extras: (extras.data ?? {}) as unknown as ReportExtras,
    targets,
  });
}

export function smartModel(): string {
  const model = process.env.CLAUDE_MODEL_SMART;
  if (!model) throw new Error("Falta CLAUDE_MODEL_SMART.");
  return model;
}

/** ai_usage is written by the service role only. */
export async function recordUsage(orgId: string, purpose: string, calls: CallRecord[]): Promise<void> {
  if (!calls.length) return;
  const admin = createAdminClient();
  for (const call of calls) {
    const { error } = await admin.rpc("record_ai_usage", {
      p_org_id: orgId,
      p_model: call.model,
      p_purpose: purpose,
      p_input_tokens: call.usage.inputTokens,
      p_output_tokens: call.usage.outputTokens,
      p_cache_read_tokens: call.usage.cacheReadTokens,
      p_cache_write_tokens: call.usage.cacheWriteTokens,
      p_cost_usd: call.costUsd ?? 0,
    });
    if (error) console.error(`[${purpose}] ai_usage:`, error.message);
  }
}

export function reportTitle(facts: ReportFacts): string {
  const kind = { daily: "Reporte diario", weekly: "Reporte semanal", monthly: "Reporte mensual" }[facts.period.kind];
  return `${kind} · ${facts.period.label}`;
}

/**
 * Computes ReportFacts, asks Claude for the narrative and stores a draft.
 * `client` decides who writes: the editor's session or the service role (cron).
 */
export async function createReportDraft(
  client: Client,
  input: {
    orgId: string;
    kind: ReportKind;
    endDay?: string;
    recipients?: string[];
    scheduleId?: string | null;
    anthropic?: Anthropic;
  },
): Promise<string> {
  const period = reportPeriod(input.kind, input.endDay);
  const facts = await loadReportFacts(client, input.orgId, period);
  const model = smartModel();
  let narrative: Narrative;
  try {
    const result = await generateNarrative(input.anthropic ?? new Anthropic(), model, facts);
    narrative = result.narrative;
    await recordUsage(input.orgId, "report", result.calls);
  } catch (error) {
    if (error instanceof NarrativeError) await recordUsage(input.orgId, "report", error.calls);
    throw error;
  }

  const { data, error } = await client
    .from("reports")
    .insert({
      org_id: input.orgId,
      period: input.kind,
      period_start: period.startDay,
      period_end: period.endDay,
      title: reportTitle(facts),
      facts: facts as never,
      content: narrative as never,
      model,
      recipients: input.recipients ?? [],
      schedule_id: input.scheduleId ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`No se pudo guardar el reporte: ${error.message}`);
  return data.id;
}
