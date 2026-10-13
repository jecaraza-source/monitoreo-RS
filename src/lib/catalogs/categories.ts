"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type CategoryResult = { ok: true; message: string } | { ok: false; message: string };
const FORBIDDEN: CategoryResult = { ok: false, message: "Sólo un administrador puede editar categorías." };

const categorySchema = z
  .object({
    id: z.guid().optional(),
    name: z.string().trim().min(2, "El nombre es muy corto.").max(80),
    description: z.string().trim().max(300).default(""),
    defaultDepartmentId: z.guid().nullable().default(null),
    active: z.boolean().default(true),
    // Departments that can attend the category (capabilities).
    departmentIds: z.array(z.guid()).max(100).default([]),
  })
  .refine((c) => !c.defaultDepartmentId || c.departmentIds.includes(c.defaultDepartmentId), {
    message: "La dependencia sugerida debe estar entre las que pueden atenderla.",
    path: ["defaultDepartmentId"],
  });

/**
 * Saves a case category and the departments able to attend it. The org comes
 * from the session; RLS (admin) and the audit triggers record each change.
 * Categories are deactivated, never deleted (cases keep their category).
 */
export async function saveCaseCategory(input: unknown): Promise<CategoryResult> {
  let orgId: string;
  try {
    orgId = (await requireRole(["admin"])).orgId;
  } catch {
    return FORBIDDEN;
  }
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();

  const row = { name: v.name, description: v.description, default_department_id: v.defaultDepartmentId, active: v.active, updated_at: new Date().toISOString() };
  const saved = v.id
    ? await supabase.from("case_categories").update(row).eq("id", v.id).eq("org_id", orgId).select("id").single()
    : await supabase.from("case_categories").insert({ ...row, org_id: orgId }).select("id").single();
  if (saved.error) {
    if (saved.error.code === "23505") return { ok: false, message: "Ya existe una categoría con ese nombre." };
    if (saved.error.code === "42501" || saved.error.code === "PGRST116") return FORBIDDEN;
    console.error("[categories]", saved.error.code, saved.error.message);
    return { ok: false, message: "No se pudo guardar la categoría." };
  }
  const categoryId = saved.data.id;

  const { data: current } = await supabase.from("department_capabilities").select("department_id").eq("category_id", categoryId);
  const before = new Set((current ?? []).map((c) => c.department_id));
  const after = new Set(v.departmentIds);
  const removed = [...before].filter((d) => !after.has(d));
  const added = [...after].filter((d) => !before.has(d));
  if (removed.length) {
    const { error } = await supabase.from("department_capabilities").delete().eq("category_id", categoryId).in("department_id", removed);
    if (error) return { ok: false, message: "No se pudieron actualizar las dependencias." };
  }
  if (added.length) {
    const { error } = await supabase
      .from("department_capabilities")
      .insert(added.map((departmentId) => ({ org_id: orgId, department_id: departmentId, category_id: categoryId })));
    if (error) return { ok: false, message: "No se pudieron actualizar las dependencias." };
  }
  revalidatePath("/configuracion/catalogos");
  revalidatePath("/configuracion/municipio");
  return { ok: true, message: v.id ? "Categoría actualizada." : "Categoría agregada." };
}
