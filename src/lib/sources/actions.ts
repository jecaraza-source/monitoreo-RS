"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getConnector, type SourceType } from "@/lib/connectors";
import { withDeadline } from "@/lib/connectors/http";
import { ConnectorError } from "@/lib/connectors/types";
import { requireRole } from "@/lib/auth/session";
import { assignQueries, compileQueries } from "@/lib/ingest/assign";
import { runIngest, type SourceRunResult } from "@/lib/ingest/run";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const PATH = "/configuracion/fuentes";
const EDITORS = ["admin", "comunicacion"] as const;
/** A source can be read by hand at most once per this many seconds. */
const MANUAL_GAP_SECONDS = 60;
/** Same deadline as a source run in the ingest worker. */
const TEST_TIMEOUT_MS = 25_000;

export type SourceActionResult<T = undefined> = { ok: true; message: string; data?: T } | { ok: false; message: string };

async function editor() {
  try {
    return await requireRole(EDITORS);
  } catch {
    return null;
  }
}
const FORBIDDEN = { ok: false as const, message: "No tienes permiso para administrar fuentes." };
const UNOFFICIAL_ADMIN_ONLY = { ok: false as const, message: "Sólo administración puede conectar o configurar fuentes no oficiales." };
const idSchema = z.guid("Identificador inválido.");

const saveSchema = z.object({
  id: idSchema.nullable(),
  name: z.string().trim().min(2, "Ponle nombre a la fuente.").max(120),
  type: z.enum(["meta", "rss", "youtube", "x", "bluesky", "reddit", "rss_bridge", "apify"]),
  config: z.record(z.string(), z.unknown()),
  /** Write-only credential; empty keeps the stored one. */
  secret: z.string().max(2000).optional(),
});

export async function saveSource(input: unknown): Promise<SourceActionResult<{ id: string }>> {
  const member = await editor();
  if (!member) return FORBIDDEN;
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  const { id, name, type, secret } = parsed.data;

  const connector = getConnector(type as SourceType);
  if (!connector.enabled) return { ok: false, message: `${connector.label}: este conector aún no está disponible.` };
  // The database enforces it too (guard_unofficial_source); checked here for a clear message.
  if (!connector.official && member.role !== "admin") return UNOFFICIAL_ADMIN_ONLY;
  const config = connector.configSchema.safeParse(parsed.data.config);
  if (!config.success) return { ok: false, message: config.error.issues[0]?.message ?? "Configuración inválida." };

  const supabase = await createClient();
  if (id) {
    const { data: existing } = await supabase.from("sources").select("type").eq("id", id).eq("org_id", member.orgId).maybeSingle();
    if (!existing) return { ok: false, message: "Fuente no encontrada." };
    if (existing.type !== type) return { ok: false, message: "No se puede cambiar el tipo de una fuente." };
  }
  const row = { name, config: config.data as never };
  const saved = id
    ? await supabase.from("sources").update(row).eq("id", id).eq("org_id", member.orgId).select("id, type").single()
    : await supabase.from("sources").insert({ ...row, type, org_id: member.orgId, is_active: true }).select("id, type").single();
  if (saved.error || !saved.data) {
    if (saved.error?.code === "42501" && !connector.official) return UNOFFICIAL_ADMIN_ONLY;
    console.error("[sources] save:", saved.error?.code);
    return { ok: false, message: "No se pudo guardar la fuente." };
  }

  if (secret?.trim()) {
    const { error } = await supabase.rpc("set_source_secret", { p_source_id: saved.data.id, p_secret: secret });
    if (error) return { ok: false, message: "La fuente se guardó, pero no la credencial." };
  }
  revalidatePath(PATH);
  return { ok: true, message: id ? "Fuente actualizada." : "Fuente conectada.", data: { id: saved.data.id } };
}

export async function setSourceActive(sourceId: string, active: boolean): Promise<SourceActionResult> {
  const member = await editor();
  if (!member) return FORBIDDEN;
  if (!idSchema.safeParse(sourceId).success) return { ok: false, message: "Fuente inválida." };
  const supabase = await createClient();
  const { error } = await supabase.from("sources").update({ is_active: active }).eq("id", sourceId).eq("org_id", member.orgId);
  if (error) return { ok: false, message: "No se pudo cambiar el estado." };
  revalidatePath(PATH);
  return { ok: true, message: active ? "Fuente activada." : "Fuente pausada." };
}

export async function clearSourceSecret(sourceId: string): Promise<SourceActionResult> {
  const member = await editor();
  if (!member) return FORBIDDEN;
  if (!idSchema.safeParse(sourceId).success) return { ok: false, message: "Fuente inválida." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_source_secret", { p_source_id: sourceId });
  if (error) return { ok: false, message: "No se pudo quitar la credencial." };
  revalidatePath(PATH);
  return { ok: true, message: "Credencial eliminada." };
}

/** Deleting a source would delete its mentions (FK cascade), so only empty sources can go. */
export async function deleteSource(sourceId: string): Promise<SourceActionResult> {
  const member = await editor();
  if (!member) return FORBIDDEN;
  if (!idSchema.safeParse(sourceId).success) return { ok: false, message: "Fuente inválida." };
  const supabase = await createClient();
  const { count } = await supabase.from("mentions").select("id", { count: "exact", head: true }).eq("source_id", sourceId);
  if (count) {
    return { ok: false, message: `Tiene ${count} menciones guardadas. Páusala en lugar de eliminarla.` };
  }
  const { error } = await supabase.from("sources").delete().eq("id", sourceId).eq("org_id", member.orgId);
  if (error) return { ok: false, message: "No se pudo eliminar la fuente." };
  revalidatePath(PATH);
  return { ok: true, message: "Fuente eliminada." };
}

export type TestSample = { text: string; url: string | null; publishedAt: string; kind: string; queryName: string | null };
export type TestResult = { fetched: number; kept: number; unmatched: number; sample: TestSample[] };

/** Fetches the last 7 days without saving anything, and shows what would be kept. */
export async function testSource(sourceId: string): Promise<SourceActionResult<TestResult>> {
  const member = await editor();
  if (!member) return FORBIDDEN;
  if (!idSchema.safeParse(sourceId).success) return { ok: false, message: "Fuente inválida." };

  const supabase = await createClient();
  const { data: source } = await supabase
    .from("sources")
    .select("id, type, config, cursor")
    .eq("id", sourceId)
    .eq("org_id", member.orgId)
    .maybeSingle();
  if (!source) return { ok: false, message: "Fuente no encontrada." };

  const connector = getConnector(source.type);
  const config = connector.configSchema.safeParse(source.config);
  if (!config.success) return { ok: false, message: `Configuración inválida: ${config.error.issues[0]?.message}` };

  try {
    let secret: string | null = null;
    if (connector.requiresSecret) {
      // Authorized above (editor of this org); the service role only reads this source's secret.
      const { data } = await createAdminClient().rpc("get_source_secret", { p_source_id: source.id });
      secret = data ?? null;
      if (!secret) return { ok: false, message: "Falta la credencial de esta fuente." };
    }
    const since = new Date(Date.now() - 7 * 86_400_000);
    const result = await withDeadline(
      (signal) =>
        connector.fetchSince(
          { id: source.id, config: config.data, cursor: (source.cursor ?? {}) as Record<string, unknown> },
          since,
          { secret, limit: 50, signal },
        ),
      TEST_TIMEOUT_MS,
    );

    const { data: queries } = await supabase
      .from("queries")
      .select("id, name, expression")
      .eq("org_id", member.orgId)
      .eq("is_active", true)
      .order("created_at");
    const names = new Map((queries ?? []).map((q) => [q.id, q.name]));
    const requireMatch = (config.data as { requireMatch?: boolean }).requireMatch ?? connector.defaultRequireMatch;
    const { kept, unmatched } = assignQueries(result.mentions, compileQueries(queries ?? []).compiled, requireMatch);

    return {
      ok: true,
      message: `Conexión correcta: ${result.mentions.length} elementos en los últimos 7 días.`,
      data: {
        fetched: result.mentions.length,
        kept: kept.length,
        unmatched,
        sample: kept.slice(0, 5).map((m) => ({
          text: m.text.slice(0, 280),
          url: m.url,
          publishedAt: m.publishedAt,
          kind: m.kind,
          queryName: m.queryId ? (names.get(m.queryId) ?? null) : null,
        })),
      },
    };
  } catch (error) {
    if (error instanceof ConnectorError) return { ok: false, message: error.message };
    console.error("[sources] test:", error);
    return { ok: false, message: "La prueba falló por un error inesperado." };
  }
}

/** Runs one source through the real pipeline now (same as the cron, logged as manual). */
export async function runSourceNow(sourceId: string): Promise<SourceActionResult<SourceRunResult>> {
  const member = await editor();
  if (!member) return FORBIDDEN;
  if (!idSchema.safeParse(sourceId).success) return { ok: false, message: "Fuente inválida." };
  // The lease keeps a manual run from overlapping another run of the same
  // source, and the gap keeps repeated clicks from hammering the provider.
  const summary = await runIngest({ trigger: "manual", sourceIds: [sourceId], orgId: member.orgId, minGapSeconds: MANUAL_GAP_SECONDS });
  const result = summary.sources[0];
  revalidatePath(PATH);
  revalidatePath("/salud");
  if (!result) {
    return {
      ok: false,
      message: `No se pudo leer ahora: está pausada, otra corrida la está leyendo, se leyó hace menos de ${MANUAL_GAP_SECONDS} s o su conector está deshabilitado.`,
    };
  }
  if (result.status === "error") return { ok: false, message: result.error ?? "La corrida falló." };
  if (result.status === "skipped") return { ok: false, message: "No alcanzó el tiempo de la corrida; se leerá en la siguiente." };
  const counts = [
    `${result.inserted} nuevas`,
    `${result.duplicates} repetidas`,
    result.updated ? `${result.updated} con interacciones actualizadas` : "",
    result.unmatched ? `${result.unmatched} sin consulta` : "",
  ].filter(Boolean);
  const partial =
    result.status === "partial"
      ? result.complete === false
        ? " Lectura parcial: lo que falta se lee en la siguiente corrida."
        : " Con avisos de cobertura (ver corridas recientes)."
      : "";
  return { ok: true, message: `${counts.join(", ")}.${partial}`, data: result };
}

// ---------------------------------------------------------------------------
// Review queue: failed classifications and sources that keep failing
// ---------------------------------------------------------------------------

const failureSchema = z.object({ failureId: idSchema, action: z.enum(["retry", "dismiss"]) });

export async function resolveFailure(input: unknown): Promise<SourceActionResult> {
  const member = await editor();
  if (!member) return FORBIDDEN;
  const parsed = failureSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Solicitud inválida." };
  const supabase = await createClient();
  // The function checks the role and the org of the failure itself.
  const { error } = await supabase.rpc("resolve_pipeline_failure", { p_failure_id: parsed.data.failureId, p_action: parsed.data.action });
  if (error) {
    console.error("[sources] resolve failure:", error.code, error.message);
    return error.code === "42501" ? FORBIDDEN : { ok: false, message: "No se pudo actualizar el fallo." };
  }
  revalidatePath(PATH);
  revalidatePath("/salud");
  return { ok: true, message: parsed.data.action === "retry" ? "Se reintentará en la siguiente corrida." : "Fallo descartado." };
}
