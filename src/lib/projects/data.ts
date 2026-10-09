import "server-only";
import type { Member } from "@/lib/auth/session";
import { builderSchema, readKpis, readTerritory, type Kpi, type Territory } from "@/lib/projects/schema";
import type { QueryBuilderState } from "@/lib/query/builder";
import { createClient } from "@/lib/supabase/server";

export type QueryVersion = {
  id: string;
  version: number;
  name: string;
  expression: string;
  builder: QueryBuilderState | null;
  isActive: boolean;
  createdAt: string;
};

/** All versions of one query, newest first. */
export type QueryLineage = { lineageId: string; name: string; active: QueryVersion | null; versions: QueryVersion[] };

export type ProjectSummary = {
  id: string;
  name: string;
  goal: string;
  kpis: Kpi[];
  territory: Territory;
  activeQueries: number;
  updatedAt: string;
};

export type ProjectDetail = ProjectSummary & { lineages: QueryLineage[] };

function readBuilder(value: unknown): QueryBuilderState | null {
  const parsed = builderSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function getProjectList(member: Member): Promise<ProjectSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name, goal, kpis, territory, updated_at, queries(id, is_active)")
    .eq("org_id", member.orgId)
    .order("created_at");
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    goal: p.goal ?? "",
    kpis: readKpis(p.kpis),
    territory: readTerritory(p.territory),
    activeQueries: p.queries.filter((q) => q.is_active).length,
    updatedAt: p.updated_at,
  }));
}

export async function getProjectDetail(member: Member, projectId: string): Promise<ProjectDetail | null> {
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, goal, kpis, territory, updated_at")
    .eq("org_id", member.orgId)
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return null;

  const { data: rows } = await supabase
    .from("queries")
    .select("id, lineage_id, version, name, expression, builder, is_active, created_at")
    .eq("project_id", projectId)
    .order("version", { ascending: false });

  const lineages = new Map<string, QueryLineage>();
  for (const row of rows ?? []) {
    const version: QueryVersion = {
      id: row.id,
      version: row.version,
      name: row.name,
      expression: row.expression,
      builder: readBuilder(row.builder),
      isActive: row.is_active,
      createdAt: row.created_at,
    };
    const lineage = lineages.get(row.lineage_id) ?? { lineageId: row.lineage_id, name: row.name, active: null, versions: [] };
    lineage.versions.push(version);
    if (version.isActive) {
      lineage.active = version;
      lineage.name = version.name;
    }
    lineages.set(row.lineage_id, lineage);
  }

  return {
    id: project.id,
    name: project.name,
    goal: project.goal ?? "",
    kpis: readKpis(project.kpis),
    territory: readTerritory(project.territory),
    updatedAt: project.updated_at,
    activeQueries: [...lineages.values()].filter((l) => l.active).length,
    lineages: [...lineages.values()],
  };
}

export async function getNeighborhoodOptions(member: Member): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("neighborhoods").select("id, name").eq("org_id", member.orgId).order("name");
  return data ?? [];
}
