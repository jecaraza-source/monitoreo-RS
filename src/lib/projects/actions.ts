"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { requireMember } from "@/lib/auth/session";
import { ACTIVE_PROJECT_COOKIE, getProjects } from "./index";

export async function setActiveProject(projectId: string): Promise<{ ok: boolean }> {
  const id = z.uuid().safeParse(projectId);
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
