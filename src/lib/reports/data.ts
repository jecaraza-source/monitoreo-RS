import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallRecord } from "@/lib/ai/classifier";
import { buildReportFacts, generateNarrative, NarrativeError, readTargets, type AnyNarrative, type ReportContext, type ReportFacts } from "@/lib/ai/narrative";
import { parseKpiSnapshot } from "@/lib/kpi/snapshot";
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
  narrative: AnyNarrative;
  recipients: string[];
  pdfPath: string | null;
  model: string | null;
  createdAt: string;
  approvedAt: string | null;
  sentAt: string | null;
  delivery: Record<string, unknown>;
  /** A draft whose period got corrections after it was generated. */
  factsStaleAt: string | null;
  version: number;
  previousVersionId: string | null;
  kpiVersion: string | null;
  snapshotAt: string | null;
};

export const REPORT_SELECT =
  "id, org_id, period, status, title, period_start, period_end, facts, content, recipients, pdf_path, model, created_at, approved_at, sent_at, delivery, facts_stale_at, version, previous_version_id, kpi_version, snapshot_at";

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
  facts_stale_at?: string | null;
  version?: number;
  previous_version_id?: string | null;
  kpi_version?: string | null;
  snapshot_at?: string | null;
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
    narrative: r.content as unknown as AnyNarrative,
    recipients: r.recipients ?? [],
    pdfPath: r.pdf_path,
    model: r.model,
    createdAt: r.created_at,
    approvedAt: r.approved_at,
    sentAt: r.sent_at,
    delivery: (r.delivery ?? {}) as Record<string, unknown>,
    factsStaleAt: r.facts_stale_at ?? null,
    version: r.version ?? 1,
    previousVersionId: r.previous_version_id ?? null,
    kpiVersion: r.kpi_version ?? null,
    snapshotAt: r.snapshot_at ?? null,
  };
}

/**
 * Aggregates the period into ReportFacts from ONE report_snapshot call (every
 * figure and example from the same database snapshot). Works with the user's
 * session (role checked in the function) or the service role (cron).
 */
export async function loadReportFacts(client: Client, orgId: string, period: ReportPeriod): Promise<ReportFacts> {
  const [org, snapshot, departments, projects] = await Promise.all([
    client.from("organizations").select("name, state").eq("id", orgId).single(),
    client.rpc("report_snapshot", {
      p_org_id: orgId,
      p_from: period.from.toISOString(),
      p_to: period.to.toISOString(),
      p_prev_from: period.prevFrom.toISOString(),
      p_prev_to: period.prevTo.toISOString(),
      p_bucket: period.bucket,
    }),
    client.from("departments").select("name").eq("org_id", orgId).order("name"),
    client.from("projects").select("kpis").eq("org_id", orgId),
  ]);
  if (org.error) throw new Error(`No se pudo leer el municipio: ${org.error.message}`);
  if (snapshot.error) throw new Error(`No se pudieron calcular las cifras: ${snapshot.error.message}`);
  const data = (snapshot.data ?? {}) as { kpi?: unknown; context?: unknown };

  const seen = new Set<string>();
  const targets = (projects.data ?? [])
    .flatMap((p) => readTargets(p.kpis))
    .filter((t) => (seen.has(t.label) ? false : (seen.add(t.label), true)));

  return buildReportFacts({
    municipality: org.data.name,
    state: org.data.state,
    period,
    snapshot: parseKpiSnapshot(data.kpi),
    context: (data.context ?? {}) as ReportContext,
    departments: (departments.data ?? []).map((d) => d.name),
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
 * `client` reads the figures (the editor's session, so the role is checked,
 * or the service role for the cron); the row is written by the server: since
 * stage 9 editors cannot write figures themselves.
 */
export async function createReportDraft(
  client: Client,
  input: {
    orgId: string;
    kind: ReportKind;
    endDay?: string;
    recipients?: string[];
    scheduleId?: string | null;
    /** The report job that drafts it (scheduled reports): one report per job. */
    jobId?: string | null;
    /** The editor who asked for it (null for the cron). */
    createdBy?: string | null;
    anthropic?: Anthropic;
  },
): Promise<string> {
  const period = reportPeriod(input.kind, input.endDay);
  const facts = await loadReportFacts(client, input.orgId, period);
  const narrative = await writeNarrative(input.orgId, facts, input.anthropic);
  const { data, error } = await createAdminClient()
    .from("reports")
    .insert({
      org_id: input.orgId,
      period: input.kind,
      period_start: period.startDay,
      period_end: period.endDay,
      title: reportTitle(facts),
      facts: facts as never,
      content: narrative as never,
      model: smartModel(),
      recipients: input.recipients ?? [],
      schedule_id: input.scheduleId ?? null,
      created_by: input.createdBy ?? null,
      kpi_version: facts.kpi_version ?? null,
      snapshot_at: facts.as_of ?? new Date().toISOString(),
      ...(input.jobId ? { job_id: input.jobId } : {}),
    })
    .select("id")
    .single();
  if (error) throw new Error(`No se pudo guardar el reporte: ${error.message}`);
  return data.id;
}

async function writeNarrative(orgId: string, facts: ReportFacts, anthropic?: Anthropic) {
  try {
    const result = await generateNarrative(anthropic ?? new Anthropic(), smartModel(), facts);
    await recordUsage(orgId, "report", result.calls);
    return result.narrative;
  } catch (error) {
    if (error instanceof NarrativeError) await recordUsage(orgId, "report", error.calls);
    throw error;
  }
}

/**
 * New figures for a draft (corrections arrived after it was generated). The
 * text stays; the editor shows which figures no longer match.
 */
export async function refreshDraftFacts(client: Client, report: { id: string; orgId: string; kind: ReportKind; endDay: string }): Promise<void> {
  const facts = await loadReportFacts(client, report.orgId, reportPeriod(report.kind, report.endDay));
  const { error, count } = await createAdminClient()
    .from("reports")
    .update(
      { facts: facts as never, kpi_version: facts.kpi_version ?? null, snapshot_at: facts.as_of ?? new Date().toISOString(), facts_stale_at: null },
      { count: "exact" },
    )
    .eq("id", report.id)
    .eq("org_id", report.orgId)
    .eq("status", "draft");
  if (error) throw new Error(`No se pudieron actualizar las cifras: ${error.message}`);
  if (!count) throw new Error("Sólo se actualizan las cifras de un borrador.");
}

/**
 * A revision of an approved report: a new draft (version + 1, linked to it)
 * with figures computed now and the approved text as a starting point. The
 * approved version does not change.
 */
export async function createRevision(
  client: Client,
  previous: { id: string; orgId: string; kind: ReportKind; endDay: string; narrative: AnyNarrative; recipients: string[]; title: string },
  createdBy: string,
): Promise<string> {
  const facts = await loadReportFacts(client, previous.orgId, reportPeriod(previous.kind, previous.endDay));
  const period = reportPeriod(previous.kind, previous.endDay);
  const { data, error } = await createAdminClient()
    .from("reports")
    .insert({
      org_id: previous.orgId,
      period: previous.kind,
      period_start: period.startDay,
      period_end: period.endDay,
      title: previous.title.replace(/ · revisión \d+$/, ""),
      facts: facts as never,
      content: previous.narrative as never,
      model: null,
      recipients: previous.recipients,
      created_by: createdBy,
      previous_version_id: previous.id,
      kpi_version: facts.kpi_version ?? null,
      snapshot_at: facts.as_of ?? new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("Este reporte ya tiene una revisión: ábrela desde la lista.");
    throw new Error(`No se pudo crear la revisión: ${error.message}`);
  }
  return data.id;
}
