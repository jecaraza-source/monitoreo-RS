import "server-only";
import { cookies } from "next/headers";
import type { Member } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const ACTIVE_PROJECT_COOKIE = "active_project";

export type ProjectOption = { id: string; name: string };

/** Projects of the member's org. RLS returns none for dependencia. */
export async function getProjects(member: Member): Promise<ProjectOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name")
    .eq("org_id", member.orgId)
    .order("created_at");
  return data ?? [];
}

/** Project chosen in the selector, falling back to the first one. */
export async function getActiveProjectId(projects: ProjectOption[]): Promise<string | null> {
  const chosen = (await cookies()).get(ACTIVE_PROJECT_COOKIE)?.value;
  return projects.find((p) => p.id === chosen)?.id ?? projects[0]?.id ?? null;
}
