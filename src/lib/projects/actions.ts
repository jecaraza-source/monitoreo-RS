"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { requireMember, requireRole } from "@/lib/auth/session";
import { buildExpression } from "@/lib/query/builder";
import { compileQuery, validateQuery } from "@/lib/query/match";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PROJECT_COOKIE, getProjects } from "./index";
import { builderSchema, projectSchema } from "./schema";

const EDITORS = ["admin", "comunicacion"] as const;

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; message: string };

export async function setActiveProject(projectId: string): Promise<{ ok: boolean }> {
  const id = z.guid("Identificador inválido.").safeParse(projectId);
  if (!id.success) return { ok: false };

  const member = await requireMember();
  // Only accept projects this member can actually see.
  const projects = await getProjects(member);
  if (!projects.some((p) => p.id === id.data)) return { ok: false };

  (await cookies()).set(ACTIVE_PROJECT_COOKIE, id.data, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Project sheet
// ---------------------------------------------------------------------------

export async function saveProject(
  projectId: string | null,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  let member;
  try {
    member = await requireRole(EDITORS);
  } catch {
    return { ok: false, message: "No tienes permiso para editar proyectos." };
  }
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  const { name, goal, kpis, territory } = parsed.data;

  const supabase = await createClient();
  if (territory.scope === "neighborhoods") {
    // Only neighborhoods of this org count as territory.
    const { count } = await supabase
      .from("neighborhoods")
      .select("id", { count: "exact", head: true })
      .eq("org_id", member.orgId)
      .in("id", territory.neighborhoodIds);
    if (count !== territory.neighborhoodIds.length) return { ok: false, message: "Alguna colonia no existe." };
  }

  const row = {
    name,
    goal,
    kpis,
    territory,
    updated_at: new Date().toISOString(),
  };
  const result = projectId
    ? await supabase.from("projects").update(row).eq("id", projectId).eq("org_id", member.orgId).select("id").single()
    : await supabase.from("projects").insert({ ...row, org_id: member.orgId }).select("id").single();

  if (result.error || !result.data) {
    console.error("[projects] save:", result.error?.code);
    return { ok: false, message: "No se pudo guardar el proyecto." };
  }
  revalidatePath("/configuracion/proyectos", "layout");
  return { ok: true, data: { id: result.data.id } };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const saveQuerySchema = z.object({
  projectId: z.guid("Identificador inválido."),
  lineageId: z.guid("Identificador inválido.").nullable(),
  name: z.string().trim().min(1, "Ponle nombre a la consulta.").max(80),
  builder: builderSchema,
});

/** Saves the builder as a new version of the query (version 1 for a new one). */
export async function saveQueryVersion(input: unknown): Promise<ActionResult<{ lineageId: string; version: number }>> {
  try {
    await requireRole(EDITORS);
  } catch {
    return { ok: false, message: "No tienes permiso para editar consultas." };
  }
  const parsed = saveQuerySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  const { projectId, lineageId, name, builder } = parsed.data;

  // The expression is always derived on the server from the builder state.
  const built = buildExpression(builder);
  if (!built.ok) return { ok: false, message: built.message };
  const validation = validateQuery(built.expression);
  if (!validation.ok) return { ok: false, message: validation.message };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_query_version", {
    p_project_id: projectId,
    p_name: name,
    p_expression: built.expression,
    p_builder: builder,
    ...(lineageId ? { p_lineage_id: lineageId } : {}),
  });
  if (error || !data) {
    console.error("[queries] save:", error?.code);
    return { ok: false, message: "No se pudo guardar la consulta." };
  }
  revalidatePath(`/configuracion/proyectos/${projectId}`);
  return { ok: true, data: { lineageId: data.lineage_id, version: data.version } };
}

export type PreviewMention = {
  id: string;
  text: string;
  publishedAt: string;
  url: string | null;
  sentiment: "positive" | "neutral" | "negative" | null;
};

export type PreviewResult = { scanned: number; matched: number; sample: PreviewMention[] };

const PREVIEW_SCAN_LIMIT = 2000;
const PREVIEW_SAMPLE = 20;

/** Runs an expression against the org's most recent mentions. */
export async function previewQuery(expression: string): Promise<ActionResult<PreviewResult>> {
  let member;
  try {
    member = await requireRole(EDITORS);
  } catch {
    return { ok: false, message: "No tienes permiso para probar consultas." };
  }
  const validation = validateQuery(expression);
  if (!validation.ok) return { ok: false, message: validation.message };
  const test = compileQuery(expression);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mentions")
    .select("id, text, published_at, url, classifications(sentiment)")
    .eq("org_id", member.orgId)
    .order("published_at", { ascending: false })
    .limit(PREVIEW_SCAN_LIMIT);
  if (error) return { ok: false, message: "No se pudieron leer las menciones." };

  const hits = data.filter((mention) => test(mention.text));
  return {
    ok: true,
    data: {
      scanned: data.length,
      matched: hits.length,
      sample: hits.slice(0, PREVIEW_SAMPLE).map((m) => ({
        id: m.id,
        text: m.text,
        publishedAt: m.published_at,
        url: m.url,
        // One classification per mention (unique mention_id); PostgREST returns it as a list.
        sentiment: m.classifications[0]?.sentiment ?? null,
      })),
    },
  };
}
