import "server-only";
import type { Member } from "@/lib/auth/session";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export type VerifiedAuthor = Pick<
  Database["public"]["Tables"]["verified_authors"]["Row"],
  | "id"
  | "platform"
  | "handle"
  | "kind"
  | "display_name"
  | "evidence"
  | "evidence_url"
  | "verified_by_name"
  | "verified_at"
  | "revoked_at"
  | "revoked_by_name"
  | "revoked_reason"
>;

export type AuthorsOverview = {
  entries: VerifiedAuthor[];
  /** Aggregate only: how many accounts and mentions are not verified (never who). */
  unverified: { accounts: number; mentions: number };
};

export async function getVerifiedAuthors(member: Member): Promise<AuthorsOverview> {
  const supabase = await createClient();
  const [entries, accounts] = await Promise.all([
    supabase
      .from("verified_authors")
      .select("id, platform, handle, kind, display_name, evidence, evidence_url, verified_by_name, verified_at, revoked_at, revoked_by_name, revoked_reason")
      .eq("org_id", member.orgId)
      .order("revoked_at", { ascending: true, nullsFirst: true })
      .order("display_name"),
    supabase.from("authors").select("id", { count: "exact", head: true }).eq("org_id", member.orgId).eq("verification", "unverified"),
  ]);
  if (entries.error) throw new Error(`No se pudo leer el catálogo: ${entries.error.message}`);
  const mentions = await supabase
    .from("mentions")
    .select("id, authors!inner(verification)", { count: "exact", head: true })
    .eq("org_id", member.orgId)
    .eq("authors.verification", "unverified");
  return { entries: entries.data ?? [], unverified: { accounts: accounts.count ?? 0, mentions: mentions.count ?? 0 } };
}
