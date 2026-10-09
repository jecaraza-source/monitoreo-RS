import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
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

const SOURCE_LABEL: Record<Enums["source_type"], string> = { meta: "Facebook", rss: "RSS", youtube: "YouTube", x: "X" };

/** Pending mentions read per round; they are grouped by project into batches of MAX_BATCH. */
const FETCH_LIMIT = 100;
const TIME_BUDGET_MS = 45_000;

export function modelPlan(): ModelPlan {
  const fast = process.env.CLAUDE_MODEL_FAST;
  const smart = process.env.CLAUDE_MODEL_SMART;
  if (!fast || !smart) throw new Error("Faltan CLAUDE_MODEL_FAST y/o CLAUDE_MODEL_SMART.");
  return { fast, smart };
}

export type ClassifySummary = {
  batches: number;
  classified: number;
  failed: number;
  escalated: number;
  costUsd: number;
  /** Set when the run stopped early (API down, bad key…); remaining mentions stay pending. */
  stoppedBy?: string;
};

type PendingRow = {
  id: string;
  org_id: string;
  text: string;
  published_at: string;
  queries: { project_id: string } | null;
  sources: { type: Enums["source_type"]; name: string } | null;
  authors: { display_name: string | null; kind: Enums["author_kind"] } | null;
};

type LoadedContext = {
  ctx: ClassifierContext;
  departmentIds: Map<string, string>;
  neighborhoodIds: Map<string, string>;
};

function originOf(row: PendingRow): string {
  const source = row.sources ? SOURCE_LABEL[row.sources.type] : "Fuente";
  if (!row.authors) return `${source} · comentario o publicación ciudadana`;
  const who = row.authors.display_name ?? "autor sin nombre";
  return row.authors.kind === "media" ? `${source} · nota de ${who} (medio)` : `${source} · publicación de ${who}`;
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
 * Uses the service role; callers must authorize (CRON_SECRET).
 */
export async function classifyPending(options: { client?: Anthropic; maxBatches?: number } = {}): Promise<ClassifySummary> {
  const started = Date.now();
  const admin = createAdminClient();
  const client = options.client ?? new Anthropic();
  const models = modelPlan();
  const summary: ClassifySummary = { batches: 0, classified: 0, failed: 0, escalated: 0, costUsd: 0 };
  const contexts = new Map<string, Promise<LoadedContext>>();
  const defaults = new Map<string, Promise<string | null>>();

  while (Date.now() - started < TIME_BUDGET_MS && summary.batches < (options.maxBatches ?? Infinity)) {
    const { data, error } = await admin
      .from("mentions")
      .select("id, org_id, text, published_at, queries(project_id), sources(type, name), authors(display_name, kind)")
      .eq("status", "pending")
      .order("created_at")
      .limit(FETCH_LIMIT);
    if (error) throw new Error(`No se pudieron leer las menciones: ${error.message}`);
    const rows = (data ?? []) as unknown as PendingRow[];
    if (rows.length === 0) break;

    // Group by (org, project): every batch shares one cached system prompt.
    const groups = new Map<string, { orgId: string; projectId: string | null; rows: PendingRow[] }>();
    for (const row of rows) {
      let projectId = row.queries?.project_id ?? null;
      if (!projectId) {
        if (!defaults.has(row.org_id)) defaults.set(row.org_id, defaultProject(admin, row.org_id));
        projectId = await defaults.get(row.org_id)!;
      }
      const key = `${row.org_id}:${projectId ?? ""}`;
      const group = groups.get(key) ?? { orgId: row.org_id, projectId, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    }

    for (const group of groups.values()) {
      for (let i = 0; i < group.rows.length; i += MAX_BATCH) {
        if (Date.now() - started >= TIME_BUDGET_MS || summary.batches >= (options.maxBatches ?? Infinity)) return summary;
        const key = `${group.orgId}:${group.projectId ?? ""}`;
        if (!contexts.has(key)) contexts.set(key, loadContext(admin, group.orgId, group.projectId));
        const loaded = await contexts.get(key)!;
        const batch = group.rows.slice(i, i + MAX_BATCH);
        try {
          await runBatch(admin, client, models, loaded, group.orgId, batch, summary);
        } catch (error) {
          // API/network problems leave the batch pending for the next run.
          summary.stoppedBy = error instanceof Anthropic.APIError ? `Anthropic ${error.status}: ${error.message}` : String(error);
          console.error("[classify] stopped:", summary.stoppedBy);
          return summary;
        }
      }
    }
  }
  return summary;
}

async function runBatch(
  admin: Admin,
  client: Anthropic,
  models: ModelPlan,
  loaded: LoadedContext,
  orgId: string,
  rows: PendingRow[],
  summary: ClassifySummary,
) {
  const mentions: MentionInput[] = rows.map((r) => ({ id: r.id, text: r.text, origin: originOf(r), publishedAt: r.published_at }));
  const result = await classifyBatch(client, models, loaded.ctx, mentions);
  summary.batches++;
  summary.escalated += result.escalated;

  for (const call of result.calls) {
    summary.costUsd += call.costUsd ?? 0;
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

  if (result.results.size) {
    const rowsToSave = [...result.results].map(([mentionId, c]) => ({
      org_id: orgId,
      mention_id: mentionId,
      sentiment: SENTIMENT_DB[c.sentiment],
      confidence: Math.round(c.confidence * 1000) / 1000,
      emotion: c.emotion,
      topic: c.topic,
      intent: c.intent,
      priority: PRIORITY_DB[c.priority],
      department_id: c.department ? (loaded.departmentIds.get(c.department) ?? null) : null,
      neighborhood_id: c.neighborhood ? (loaded.neighborhoodIds.get(c.neighborhood) ?? null) : null,
      model: c.model,
      corrected_by: null,
    }));
    const { error } = await admin.from("classifications").upsert(rowsToSave, { onConflict: "mention_id" });
    if (error) throw new Error(`classifications: ${error.message}`);
    await admin.from("mentions").update({ status: "classified" }).in("id", [...result.results.keys()]);
    summary.classified += result.results.size;
  }

  if (result.failed.length) {
    console.warn("[classify] failed:", result.failed[0].error);
    await admin.from("mentions").update({ status: "failed" }).in("id", result.failed.map((f) => f.id));
    summary.failed += result.failed.length;
  }
}
