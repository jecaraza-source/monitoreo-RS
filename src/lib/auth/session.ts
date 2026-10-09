import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canAccessPath, homeForRole, isRole, type Role } from "./roles";

export type Member = {
  userId: string;
  email: string;
  orgId: string;
  orgName: string;
  role: Role;
  departmentId: string | null;
  departmentName: string | null;
};

export type Session = {
  userId: string;
  email: string;
  /** Null when the user can sign in but has no membership yet. */
  member: Member | null;
};

/**
 * Data Access Layer entry point. Deduplicated per request. Reads cookies, so
 * callers must render inside a <Suspense> boundary (Cache Components).
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const claims = auth?.claims;
  if (!claims?.sub) return null;

  const email = claims.email ?? "";

  // A user normally belongs to one municipality; with several, the oldest wins
  // until an org switcher exists.
  const { data: membership } = await supabase
    .from("memberships")
    .select("org_id, role, department_id, organizations(name), departments(name)")
    .eq("user_id", claims.sub)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (!membership || !isRole(membership.role)) {
    return { userId: claims.sub, email, member: null };
  }

  return {
    userId: claims.sub,
    email,
    member: {
      userId: claims.sub,
      email,
      orgId: membership.org_id,
      orgName: membership.organizations?.name ?? "",
      role: membership.role,
      departmentId: membership.department_id,
      departmentName: membership.departments?.name ?? null,
    },
  };
});

/** Signed-in, provisioned member; redirects otherwise. */
export async function requireMember(): Promise<Member> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.member) redirect("/sin-acceso");
  return session.member;
}

/**
 * Member allowed to open `pathname`; others go to their own home section.
 * Call it at the top of every page under (app), with the page's own path.
 */
export async function requireSection(pathname: string): Promise<Member> {
  const member = await requireMember();
  if (!canAccessPath(member.role, pathname)) redirect(homeForRole(member.role));
  return member;
}

/** For Server Actions: re-check the role close to the mutation. */
export async function requireRole(roles: readonly Role[]): Promise<Member> {
  const member = await requireMember();
  if (!roles.includes(member.role)) {
    throw new Error("No tienes permiso para realizar esta acción.");
  }
  return member;
}
