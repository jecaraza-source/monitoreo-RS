import "server-only";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { refreshMentionStats } from "@/lib/dashboard/refresh";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  classifyBatch,
  DEFAULT_TOPICS,
  MAX_BATCH,
  type Classification,
  type ClassifierContext,
  type MentionInput,
  type ModelPlan,
} from "./classifier";

type Admin = ReturnType<typeof createAdminClient>;
type Enums = Database["public"]["Enums"];

const SENTIMENT_DB: Record<Classification["sentiment"], Enums["sentiment"]> = {
  positivo: "positive",
  neutral: "neutral",
  negativo: "negative",
};
const PRIORITY_DB: Record<Classification["priority"], Enums["priority"]> = { alta: "high", media: "medium", baja: "low" };
const SEVERITY_DB: Record<Classification["severity"], Enums["severity"]> = {
  ninguna: "none",
  baja: "low",
  media: "moderate",
  alta: "high",
  emergencia: "emergency",
};
const INCIDENT_DB: Record<Classification["incident_type"], string> = {
  ninguno: "none",
  servicio_publico: "public_service",
  infraestructura: "infrastructure",
  seguridad: "public_safety",
  violencia: "violence",
  salud: "health",
  proteccion_civil: "civil_protection",
  medio_ambiente: "environment",
  corrupcion: "corruption",
  otro: "other",
};

const SOURCE_LABEL: Record<Enums["source_type"], string> = { meta: "Facebook", rss: "RSS", youtube: "YouTube", x: "X" };

/** Mentions claimed per round; they are grouped by project into batches of MAX_BATCH. */
const CLAIM_LIMIT = 40;
const TIME_BUDGET_MS = 45_000;
/** A batch is not started with less time left than this (one call plus its corrective retry). */
const MIN_BATCH_MS = 20_000;
/** Per-call ceiling; the SDK retries once on overload. */
const CALL_TIMEOUT_MS = 30_000;
/** Longer than any worker can live (maxDuration 60 s): a claim outlives its worker only if it crashed. */
const LEASE_SECONDS = 180;
/** Attempts per mention before it goes to the review queue. */
export const MAX_ATTEMPTS = 5;

export function modelPlan(): ModelPlan {
  const fast = process.env.CLAUDE_MODEL_FAST;
  const smart = process.env.CLAUDE_MODEL_SMART;
  if (!fast || !smart) throw new Error("Faltan CLAUDE_MODEL_FAST y/o CLAUDE_MODEL_SMART.");
  return { fast, smart };
}

/** Counters returned by the database (complete_classifications), per organization. */
export type OrgCounters = {
  claimed: number;
  saved: number;
  keptCorrection: number;
  stale: number;
  retry: number;
  dead: number;
  released: number;
  aiCalls: number;
  costUsd: number;
};

export type ClassifySummary = {
  runId?: string;
  batches: number;
  classified: number;
  failed: number;
  escalated: number;
  costUsd: number;
  /** Set when the run stopped early (API down, bad key…); unprocessed claims are released. */
  stoppedBy?: string;
  orgs?: Record<string, OrgCounters>;
};

type PendingRow = {
  id: string;
  org_id: string;
  text: string;
  published_at: string;
  attempts: number;
  project_id: string | null;
  source_type: Enums["source_type"];
  source_name: string;
  author_name: string | null;
  author_kind: Enums["author_kind"] | null;
};

type LoadedContext = {
  ctx: ClassifierContext;
  departmentIds: Map<string, string>;
  neighborhoodIds: Map<string, string>;
};

function originOf(row: PendingRow): string {
  const source = SOURCE_LABEL[row.source_type] ?? "Fuente";
  if (!row.author_kind) return `${source} · comentario o publicación ciudadana`;
  const who = row.author_name ?? "autor sin nombre";
  return row.author_kind === "media" ? `${source} · nota de ${who} (medio)` : `${source} · publicación de ${who}`;
}

async function loadContext(admin: Admin, orgId: string, projectId: string | null): Promise<LoadedContext> {
  const [org, project, departments, neighborhoods, riskTerms] = await Promise.all([
    admin.from("organizations").select("name, state").eq("id", orgId).single(),
    projectId
      ? admin.from("projects").select("name, goal, topics, classification_rules").eq("id", projectId).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("departments").select("id, name, short_name").eq("org_id", orgId).order("name"),
    admin.from("neighborhoods").select("id, name").eq("org_id", orgId).order("name"),
    admin.from("risk_terms").select("term, severity").eq("org_id", orgId).order("term"),
  ]);
  if (org.error || !org.data) throw new Error(`organización ${orgId} no encontrada`);
  const p = project.data;
  return {
    ctx: {
      municipality: org.data.name,
      state: org.data.state,
      projectName: p?.name ?? "General",
      projectGoal: p?.goal ?? "",
      topics: p?.topics?.length ? [...p.topics].sort((a, b) => a.localeCompare(b, "es")) : DEFAULT_TOPICS,
      projectRules: p?.classification_rules ?? "",
      departments: (departments.data ?? []).map((d) => ({ name: d.name, shortName: d.short_name })),
      neighborhoods: (neighborhoods.data ?? []).map((n) => n.name),
      riskTerms: (riskTerms.data ?? []).map((r) => ({ term: r.term, severity: r.severity })),
    },
    departmentIds: new Map((departments.data ?? []).map((d) => [d.name, d.id])),
    neighborhoodIds: new Map((neighborhoods.data ?? []).map((n) => [n.name, n.id])),
  };
}

/** Default project for mentions captured without a query (e.g. comments on the official page). */
async function defaultProject(admin: Admin, orgId: string): Promise<string | null> {
  const { data } = await admin.from("projects").select("id").eq("org_id", orgId).order("created_at").limit(1).maybeSingle();
  return data?.id ?? null;
}

/**
 * Classifies pending mentions in batches of up to 20 (one Claude call each,
 * plus the smart re-pass) until none are left or the time budget runs out.
 * Mentions are claimed with a lease first, so concurrent workers never send
 * the same mention to Claude. Uses the service role; callers must authorize
 * (CRON_SECRET).
 */
export async function classifyPending(
  options: { client?: Anthropic; maxBatches?: number; trigger?: "cron" | "manual" } = {},
): Promise<ClassifySummary> {
  const admin = createAdminClient();
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  await heartbeat(admin, "start");
  let summary: ClassifySummary;
  try {
    summary = await classifyLoop(admin, runId, options);
  } catch (error) {
    await heartbeat(admin, "finish", error instanceof Error ? error.message : String(error));
    throw error;
  }
  await heartbeat(admin, "finish", summary.stoppedBy);
  // New sentiment/topic/neighborhood values change the dashboard rollup.
  if (summary.classified > 0) await refreshMentionStats(admin);
  await logWorkerRuns(admin, runId, options.trigger ?? "cron", startedAt, summary);
  return summary;
}

function counters(summary: ClassifySummary, orgId: string): OrgCounters {
  summary.orgs ??= {};
  return (summary.orgs[orgId] ??= { claimed: 0, saved: 0, keptCorrection: 0, stale: 0, retry: 0, dead: 0, released: 0, aiCalls: 0, costUsd: 0 });
}

async function classifyLoop(
  admin: Admin,
  runId: string,
  options: { client?: Anthropic; maxBatches?: number },
): Promise<ClassifySummary> {
  const started = Date.now();
  const deadline = started + TIME_BUDGET_MS;
  const client = options.client ?? new Anthropic({ timeout: CALL_TIMEOUT_MS, maxRetries: 1 });
  const models = modelPlan();
  const summary: ClassifySummary = { runId, batches: 0, classified: 0, failed: 0, escalated: 0, costUsd: 0 };
  const contexts = new Map<string, Promise<LoadedContext>>();
  const defaults = new Map<string, Promise<string | null>>();
  // Cancels in-flight Claude calls when the run's time is over.
  const budget = AbortSignal.timeout(TIME_BUDGET_MS + 10_000);
  const maxBatches = options.maxBatches ?? Infinity;

  const enoughTime = () => deadline - Date.now() >= MIN_BATCH_MS && summary.batches < maxBatches;

  while (enoughTime()) {
    const { data, error } = await admin.rpc("claim_mentions", {
      p_claim_id: runId,
      p_limit: Math.min(CLAIM_LIMIT, Number.isFinite(maxBatches) ? (maxBatches - summary.batches) * MAX_BATCH : CLAIM_LIMIT),
      p_lease_seconds: LEASE_SECONDS,
      p_max_attempts: MAX_ATTEMPTS,
    });
    if (error) throw new Error(`No se pudieron reservar las menciones: ${error.message}`);
    const rows = (data ?? []) as PendingRow[];
    if (rows.length === 0) break;
    for (const row of rows) counters(summary, row.org_id).claimed++;

    // Group by (org, project): every batch shares one cached system prompt.
    const groups = new Map<string, { orgId: string; projectId: string | null; rows: PendingRow[] }>();
    for (const row of rows) {
      let projectId = row.project_id;
      if (!projectId) {
        if (!defaults.has(row.org_id)) defaults.set(row.org_id, defaultProject(admin, row.org_id));
        projectId = await defaults.get(row.org_id)!;
      }
      const key = `${row.org_id}:${projectId ?? ""}`;
      const group = groups.get(key) ?? { orgId: row.org_id, projectId, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    }
    const batches = [...groups.values()].flatMap((g) =>
      Array.from({ length: Math.ceil(g.rows.length / MAX_BATCH) }, (_, i) => ({ ...g, rows: g.rows.slice(i * MAX_BATCH, (i + 1) * MAX_BATCH) })),
    );

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      if (!enoughTime()) {
        await release(admin, runId, batches.slice(b), summary, false);
        return summary;
      }
      const key = `${batch.orgId}:${batch.projectId ?? ""}`;
      if (!contexts.has(key)) contexts.set(key, loadContext(admin, batch.orgId, batch.projectId));
      try {
        const loaded = await contexts.get(key)!;
        await runBatch(admin, client, models, loaded, batch.orgId, batch.rows, summary, runId, budget);
      } catch (error) {
        // Provider down, bad key, timeout or a failed save: this batch and the
        // rest go back without spending an attempt (a save that failed rolled
        // back as a whole), and the run stops.
        summary.stoppedBy = error instanceof Anthropic.APIError ? `Anthropic ${error.status}: ${error.message}` : error instanceof Error ? error.message : String(error);
        console.error("[classify] stopped:", summary.stoppedBy);
        await release(admin, runId, batches.slice(b), summary, false, summary.stoppedBy);
        return summary;
      }
    }
  }
  return summary;
}

async function release(
  admin: Admin,
  runId: string,
  batches: { orgId: string; rows: PendingRow[] }[],
  summary: ClassifySummary,
  countAttempt: boolean,
  error?: string,
) {
  for (const batch of batches) {
    const { data, error: releaseError } = await admin.rpc("release_mentions", {
      p_claim_id: runId,
      p_ids: batch.rows.map((r) => r.id),
      p_count_attempt: countAttempt,
      p_error: error ? error.slice(0, 500) : undefined,
    });
    // If this fails too, the lease expires on its own and the mentions are claimed again.
    if (releaseError) console.error("[classify] release:", releaseError.message);
    else counters(summary, batch.orgId).released += data ?? 0;
  }
}

async function runBatch(
  admin: Admin,
  client: Anthropic,
  models: ModelPlan,
  loaded: LoadedContext,
  orgId: string,
  rows: PendingRow[],
  summary: ClassifySummary,
  runId: string,
  signal: AbortSignal,
) {
  const mentions: MentionInput[] = rows.map((r) => ({ id: r.id, text: r.text, origin: originOf(r), publishedAt: r.published_at }));
  const result = await classifyBatch(client, models, loaded.ctx, mentions, { signal });
  summary.batches++;
  summary.escalated += result.escalated;
  const org = counters(summary, orgId);

  // Usage is recorded before saving: a call that happened is paid for even if the save fails.
  for (const call of result.calls) {
    summary.costUsd += call.costUsd ?? 0;
    org.aiCalls++;
    org.costUsd += call.costUsd ?? 0;
    const { error } = await admin.rpc("record_ai_usage", {
      p_org_id: orgId,
      p_model: call.model,
      p_purpose: "classify",
      p_input_tokens: call.usage.inputTokens,
      p_output_tokens: call.usage.outputTokens,
      p_cache_read_tokens: call.usage.cacheReadTokens,
      p_cache_write_tokens: call.usage.cacheWriteTokens,
      p_cost_usd: call.costUsd ?? 0,
    });
    if (error) console.error("[classify] ai_usage:", error.message);
  }

  const results = [...result.results].map(([mentionId, c]) => ({
    mention_id: mentionId,
    sentiment: SENTIMENT_DB[c.sentiment],
    confidence: Math.round(c.confidence * 1000) / 1000,
    emotion: c.emotion,
    topic: c.topic,
    intent: c.intent,
    priority: PRIORITY_DB[c.priority],
    severity: SEVERITY_DB[c.severity],
    incident_type: INCIDENT_DB[c.incident_type],
    needs_attention: c.needs_attention,
    department_id: c.department ? (loaded.departmentIds.get(c.department) ?? null) : null,
    neighborhood_id: c.neighborhood ? (loaded.neighborhoodIds.get(c.neighborhood) ?? null) : null,
    model: c.model,
  }));
  const failures = result.failed.map((f) => ({ mention_id: f.id, error: f.error }));
  if (failures.length) console.warn("[classify] failed:", failures[0].error);

  // One transaction: classifications + status, only for mentions this run still owns.
  const { data, error } = await admin.rpc("complete_classifications", {
    p_claim_id: runId,
    p_results: results as unknown as Json,
    p_failures: failures as unknown as Json,
    p_max_attempts: MAX_ATTEMPTS,
  });
  if (error) throw new Error(`No se pudo guardar la clasificación: ${error.message}`);
  const done = data as { saved: number; kept_correction: number; stale: number; retry: number; dead: number };
  org.saved += done.saved;
  org.keptCorrection += done.kept_correction;
  org.stale += done.stale;
  org.retry += done.retry;
  org.dead += done.dead;
  summary.classified += done.saved + done.kept_correction;
  summary.failed += done.retry + done.dead;
}

async function logWorkerRuns(admin: Admin, runId: string, trigger: "cron" | "manual", startedAt: string, summary: ClassifySummary) {
  const rows = Object.entries(summary.orgs ?? {}).map(([orgId, c]) => ({
    run_id: runId,
    kind: "classify",
    trigger,
    org_id: orgId,
    status: summary.stoppedBy ? (c.saved > 0 ? "partial" : "error") : c.retry + c.dead + c.stale > 0 ? "partial" : "ok",
    started_at: startedAt,
    counters: { ...c, costUsd: Math.round(c.costUsd * 10_000) / 10_000 },
    stopped_by: summary.stoppedBy ?? null,
  }));
  if (!rows.length) return;
  const { error } = await admin.from("worker_runs").insert(rows);
  if (error) console.error("[classify] worker_runs:", error.message);
}

/** Persisted "the classifier ran" mark read by the health page (also when there was nothing to do). */
async function heartbeat(admin: Admin, phase: "start" | "finish", error?: string) {
  const { error: e } = await admin.rpc("record_heartbeat", { p_kind: "classify", p_phase: phase, p_error: error?.slice(0, 500) });
  if (e) console.error("[classify] heartbeat:", e.message);
}
