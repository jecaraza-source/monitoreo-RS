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

// ---------------------------------------------------------------------------
// Access to the officials module (Percepción de funcionarios)
// ---------------------------------------------------------------------------

const accessSchema = z.object({ userId: z.guid("Usuario inválido."), allowed: z.boolean() });

/** Grants or revokes the officials module; the change is audited like any membership change. */
export async function setOfficialsAccess(input: unknown): Promise<{ ok: boolean; message: string }> {
  let admin;
  try {
    admin = await requireRole(["admin"]);
  } catch {
    return { ok: false, message: "Sólo un administrador puede dar este acceso." };
  }
  const parsed = accessSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .update({ can_view_officials: parsed.data.allowed })
    .eq("org_id", admin.orgId)
    .eq("user_id", parsed.data.userId)
    .in("role", ["comunicacion", "lectura"])
    .select("user_id");
  if (error) {
    console.error("[usuarios] officials access:", error.code);
    return { ok: false, message: "No se pudo cambiar el acceso." };
  }
  if (!data?.length) return { ok: false, message: "Sólo Comunicación y Consulta pueden recibir este acceso." };
  revalidatePath("/configuracion/usuarios");
  return { ok: true, message: parsed.data.allowed ? "Acceso a Funcionarios otorgado." : "Acceso a Funcionarios retirado." };
}

// ---------------------------------------------------------------------------
// Access to the counter-intelligence office (Radar Social)
// ---------------------------------------------------------------------------

/**
 * Grants or revokes the office. Every role but dependencia may hold it, admins
 * included (they too need the grant); the change is audited like any membership change.
 */
export async function setCounterintelAccess(input: unknown): Promise<{ ok: boolean; message: string }> {
  let admin;
  try {
    admin = await requireRole(["admin"]);
  } catch {
    return { ok: false, message: "Sólo un administrador puede dar este acceso." };
  }
  const parsed = accessSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .update({ can_view_counterintel: parsed.data.allowed })
    .eq("org_id", admin.orgId)
    .eq("user_id", parsed.data.userId)
    .in("role", ["admin", "comunicacion", "lectura"])
    .select("user_id");
  if (error) {
    console.error("[usuarios] counterintel access:", error.code);
    return { ok: false, message: "No se pudo cambiar el acceso." };
  }
  if (!data?.length) return { ok: false, message: "Una dependencia no puede recibir este acceso." };
  revalidatePath("/configuracion/usuarios");
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: parsed.data.allowed ? "Acceso a Radar Social otorgado." : "Acceso a Radar Social retirado.",
  };
}

// ---------------------------------------------------------------------------
// Edit and remove members
// ---------------------------------------------------------------------------

type MemberResult = { ok: boolean; message: string };

async function adminOnly() {
  try {
    return await requireRole(["admin"]);
  } catch {
    return null;
  }
}

function memberError(error: { code?: string; message: string }, what: string): MemberResult {
  console.error(`[usuarios] ${what}:`, error.code);
  if (error.code === "23514") {
    return error.message.includes("admin")
      ? { ok: false, message: "El municipio necesita al menos un administrador." }
      : { ok: false, message: "Un usuario de dependencia necesita su dependencia." };
  }
  return { ok: false, message: `No se pudo ${what}.` };
}

const memberSchema = z
  .object({
    userId: z.guid("Usuario inválido."),
    role: z.enum(ROLES, { error: "Elige un rol." }),
    departmentId: z.guid("Identificador inválido.").nullable(),
  })
  .refine((v) => v.role !== "dependencia" || v.departmentId, { message: "Elige la dependencia del usuario." });

/** Changes a member's role (and department, only for dependencia). */
export async function updateMember(input: unknown): Promise<MemberResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, message: "Sólo un administrador puede editar usuarios." };
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { userId, role } = parsed.data;
  if (userId === admin.userId && role !== "admin") {
    return { ok: false, message: "No puedes quitarte el rol de administrador; pídeselo a otro administrador." };
  }
  const departmentId = role === "dependencia" ? parsed.data.departmentId : null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .update({ role, department_id: departmentId })
    .eq("org_id", admin.orgId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) return memberError(error, "guardar el usuario");
  if (!data?.length) return { ok: false, message: "Usuario no encontrado." };
  revalidatePath("/configuracion/usuarios");
  return { ok: true, message: `Usuario actualizado: ${ROLE_LABELS[role]}.` };
}

/**
 * Removes a member from the municipality: they lose access at once, stop
 * being responsible of any department and their WhatsApp number is removed.
 * Their notes and the audit log keep their name.
 */
export async function removeMember(input: unknown): Promise<MemberResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, message: "Sólo un administrador puede quitar usuarios." };
  const parsed = z.object({ userId: z.guid("Usuario inválido.") }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  if (parsed.data.userId === admin.userId) return { ok: false, message: "No puedes quitarte a ti mismo." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .delete()
    .eq("org_id", admin.orgId)
    .eq("user_id", parsed.data.userId)
    .select("user_id");
  if (error) return memberError(error, "quitar al usuario");
  if (!data?.length) return { ok: false, message: "Usuario no encontrado." };
  revalidatePath("/configuracion/usuarios");
  return { ok: true, message: "Usuario quitado del municipio." };
}
