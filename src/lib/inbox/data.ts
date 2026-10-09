import "server-only";
import { DEFAULT_TOPICS, OTHER_TOPIC } from "@/lib/ai/classifier";
import type { Member } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { SourceType } from "./model";

export type InboxCatalogs = {
  departments: { id: string; name: string }[];
  neighborhoods: { id: string; name: string }[];
  sources: { id: string; name: string; type: SourceType }[];
  topics: string[];
};

/** Filter options and id → name lookups for the inbox. */
export async function getInboxCatalogs(member: Member): Promise<InboxCatalogs> {
  const supabase = await createClient();
  const [departments, neighborhoods, sources, projects] = await Promise.all([
    supabase.from("departments").select("id, name").eq("org_id", member.orgId).order("name"),
    supabase.from("neighborhoods").select("id, name").eq("org_id", member.orgId).order("name"),
    supabase.rpc("source_labels", { p_org_id: member.orgId }),
    // Departments cannot read projects; they get the default taxonomy.
    supabase.from("projects").select("topics").eq("org_id", member.orgId),
  ]);
  const projectTopics = (projects.data ?? []).flatMap((p) => p.topics);
  const topics = [...new Set(projectTopics.length ? projectTopics : DEFAULT_TOPICS)].sort((a, b) => a.localeCompare(b, "es"));
  return {
    departments: departments.data ?? [],
    neighborhoods: neighborhoods.data ?? [],
    sources: sources.data ?? [],
    topics: [...topics, OTHER_TOPIC],
  };
}
