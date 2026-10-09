"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { rateLimitMessage } from "@/lib/auth/rate-limit";
import { ROLES, ROLE_LABELS } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getSiteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type InviteState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string; field?: "email" | "role" | "departmentId" };

const schema = z
  .object({
    email: z.email("Escribe un correo válido.").trim().toLowerCase(),
    role: z.enum(ROLES, { error: "Elige un rol." }),
    departmentId: z.guid("Identificador inválido.").optional(),
  })
  .refine((v) => v.role !== "dependencia" || v.departmentId, {
    message: "Elige la dependencia del usuario.",
    path: ["departmentId"],
  });

export async function inviteUser(_prev: InviteState, formData: FormData): Promise<InviteState> {
  let admin;
  try {
    admin = await requireRole(["admin"]);
  } catch {
    return { status: "error", message: "Sólo un administrador puede invitar usuarios." };
  }

  const parsed = schema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
    departmentId: formData.get("departmentId") || undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      status: "error",
      message: issue?.message ?? "Revisa los datos.",
      field: issue?.path[0] as "email" | "role" | "departmentId" | undefined,
    };
  }
  const { email, role } = parsed.data;
  const departmentId = role === "dependencia" ? parsed.data.departmentId! : null;

  // The department must belong to the admin's own org (RLS limits the lookup to it).
  if (departmentId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("departments")
      .select("id")
      .eq("id", departmentId)
      .eq("org_id", admin.orgId)
      .maybeSingle();
    if (!data) return { status: "error", message: "La dependencia no existe.", field: "departmentId" };
  }

  const service = createAdminClient();
  const site = await getSiteUrl();
  const { data: invited, error } = await service.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${site}/auth/confirm?next=/`,
    data: { invited_by: admin.userId },
  });

  if (error || !invited.user) {
    if (error?.code === "email_exists") {
      return { status: "error", message: "Ese correo ya tiene una cuenta.", field: "email" };
    }
    const limited = rateLimitMessage(error);
    if (limited) return { status: "error", message: limited };
    console.error("[invite] inviteUserByEmail:", error?.code ?? error?.message);
    return { status: "error", message: "No se pudo enviar la invitación. Inténtalo de nuevo." };
  }

  // org_id comes from the admin's membership, never from the form.
  const { error: membershipError } = await service.from("memberships").insert({
    org_id: admin.orgId,
    user_id: invited.user.id,
    role,
    department_id: departmentId,
  });
  if (membershipError?.code === "23505") {
    // Already invited to this org and not accepted yet: Supabase just re-sent
    // the email. Keep the existing role rather than silently changing it.
    return { status: "success", message: `${email} ya estaba invitado; le reenviamos la invitación.` };
  }
  if (membershipError) {
    console.error("[invite] membership:", membershipError.code);
    await removeOrphanUser(service, invited.user.id);
    return { status: "error", message: "No se pudo asignar el rol. Inténtalo de nuevo." };
  }

  revalidatePath("/configuracion/usuarios");
  return { status: "success", message: `Invitación enviada a ${email} como ${ROLE_LABELS[role]}.` };
}

/** Undo an invitation whose membership could not be created, unless the user belongs elsewhere. */
async function removeOrphanUser(service: ReturnType<typeof createAdminClient>, userId: string) {
  const { count } = await service
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (count === 0) await service.auth.admin.deleteUser(userId);
}
