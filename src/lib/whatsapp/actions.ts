"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { PRIORITIES } from "@/lib/inbox/model";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { INVITE_TEMPLATE } from "./client";
import { INVITE_ACCEPT, INVITE_DECLINE } from "./conversation";
import { formatPhone, normalizePhone } from "./phone";
import { sendAndLog } from "./send";

export type WhatsAppActionResult = { ok: true; message: string; warning?: string } | { ok: false; message: string };

const PATH = "/configuracion/whatsapp";
const FORBIDDEN: WhatsAppActionResult = { ok: false, message: "Sólo un administrador puede configurar WhatsApp." };
const id = z.guid("Identificador inválido.");

async function admin() {
  try {
    return await requireRole(["admin"]);
  } catch {
    return null;
  }
}

function fail(error: { code?: string; message: string }, what: string): WhatsAppActionResult {
  console.error(`[whatsapp] ${what}:`, error.code, error.message);
  if (error.code === "42501") return FORBIDDEN;
  if (error.code === "23505") return { ok: false, message: "Ese número ya está registrado para otro funcionario." };
  if (error.code === "23514") return { ok: false, message: "El responsable debe ser usuario de esa dependencia, de Comunicación o administrador." };
  return { ok: false, message: `No se pudo ${what}.` };
}

// ---------------------------------------------------------------------------

const hours = z.coerce.number().int("Usa horas enteras.").min(1, "Mínimo 1 hora.").max(2160, "Máximo 90 días.");
const slaSchema = z.object(Object.fromEntries(PRIORITIES.map((p) => [p, hours])) as Record<(typeof PRIORITIES)[number], typeof hours>);

export async function saveSla(input: unknown): Promise<WhatsAppActionResult> {
  const m = await admin();
  if (!m) return FORBIDDEN;
  const parsed = slaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const sla = parsed.data;
  if (!(sla.critical <= sla.high && sla.high <= sla.medium && sla.medium <= sla.low)) {
    return { ok: false, message: "Una prioridad mayor debe tener un plazo igual o menor." };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("sla_policies").upsert(
    PRIORITIES.map((priority) => ({ org_id: m.orgId, priority, hours: sla[priority], updated_at: new Date().toISOString() })),
    { onConflict: "org_id,priority" },
  );
  if (error) return fail(error, "guardar el SLA");
  revalidatePath(PATH);
  return { ok: true, message: "SLA actualizado. Se aplica a los nuevos turnos." };
}

// ---------------------------------------------------------------------------
// Responsible per department
// ---------------------------------------------------------------------------

const responsibleSchema = z.object({ departmentId: id, userId: id.nullable() });

export async function setResponsible(input: unknown): Promise<WhatsAppActionResult> {
  const m = await admin();
  if (!m) return FORBIDDEN;
  const parsed = responsibleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("departments")
    .update({ responsible_user_id: parsed.data.userId })
    .eq("org_id", m.orgId)
    .eq("id", parsed.data.departmentId)
    .select("name");
  if (error) return fail(error, "asignar el responsable");
  if (!data?.length) return { ok: false, message: "Dependencia no encontrada." };
  revalidatePath(PATH);
  return { ok: true, message: parsed.data.userId ? `Responsable de ${data[0].name} asignado.` : `${data[0].name} quedó sin responsable.` };
}

// ---------------------------------------------------------------------------
// WhatsApp number and invitation
// ---------------------------------------------------------------------------

const inviteSchema = z.object({ departmentId: id, phone: z.string().trim().min(1, "Escribe el número de WhatsApp.").max(30) });

/**
 * Registers the responsible's number as pending and sends the invitation
 * template; it becomes active only when they tap "Acepto" on WhatsApp.
 */
export async function inviteResponsible(input: unknown): Promise<WhatsAppActionResult> {
  const m = await admin();
  if (!m) return FORBIDDEN;
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: department } = await supabase
    .from("departments")
    .select("name, responsible_user_id")
    .eq("org_id", m.orgId)
    .eq("id", parsed.data.departmentId)
    .maybeSingle();
  if (!department) return { ok: false, message: "Dependencia no encontrada." };
  if (!department.responsible_user_id) return { ok: false, message: "Primero elige al responsable de la dependencia." };
  return invite(m, department.responsible_user_id, parsed.data.phone, department.name);
}

/** The escalation contact's number: same invitation, for "seguimiento de turnos vencidos". */
export async function inviteEscalation(input: unknown): Promise<WhatsAppActionResult> {
  const m = await admin();
  if (!m) return FORBIDDEN;
  const parsed = z.object({ phone: inviteSchema.shape.phone }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data: settings } = await supabase.from("whatsapp_settings").select("escalation_user_id").eq("org_id", m.orgId).maybeSingle();
  if (!settings?.escalation_user_id) return { ok: false, message: "Primero elige a quién escalar los turnos vencidos." };
  return invite(m, settings.escalation_user_id, parsed.data.phone, "seguimiento de turnos vencidos");
}

async function invite(m: { orgId: string; orgName: string }, userId: string, rawPhone: string, responsibility: string): Promise<WhatsAppActionResult> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, message: "Número inválido. Usa 10 dígitos o el formato +52 55 1234 5678." };

  const supabase = await createClient();
  const { data: contactId, error } = await supabase.rpc("invite_whatsapp_contact", { p_org_id: m.orgId, p_user_id: userId, p_phone: phone });
  if (error) return fail(error, "registrar el número");

  const service = createAdminClient();
  const { data: user } = await service.auth.admin.getUserById(userId);
  const name = (user.user?.user_metadata?.full_name as string | undefined)?.trim() || user.user?.email?.split("@")[0] || "";
  const params = [name, m.orgName, responsibility];
  const sent = await sendAndLog(
    service,
    { orgId: m.orgId, contactId, phone },
    {
      kind: "template",
      template: INVITE_TEMPLATE,
      params,
      buttons: [INVITE_ACCEPT, INVITE_DECLINE],
      summary: `Invitación: ${name} · ${responsibility} · ${m.orgName}`,
    },
  );
  revalidatePath(PATH);
  const shown = formatPhone(phone);
  if (sent.ok) return { ok: true, message: `Invitación enviada a ${shown}. Se activará cuando la acepte en WhatsApp.` };
  if ("notConfigured" in sent && sent.notConfigured) {
    return { ok: true, message: `Número ${shown} registrado.`, warning: "WhatsApp aún no está conectado: la invitación se podrá reenviar al configurarlo." };
  }
  return { ok: true, message: `Número ${shown} registrado.`, warning: `No se pudo enviar la invitación (${sent.error}). Intenta reenviarla.` };
}

// ---------------------------------------------------------------------------
// Escalation of expired turns
// ---------------------------------------------------------------------------

const escalationSchema = z.object({ userId: id.nullable() });

export async function setEscalation(input: unknown): Promise<WhatsAppActionResult> {
  const m = await admin();
  if (!m) return FORBIDDEN;
  const parsed = escalationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase
    .from("whatsapp_settings")
    .upsert({ org_id: m.orgId, escalation_user_id: parsed.data.userId, updated_at: new Date().toISOString() }, { onConflict: "org_id" });
  if (error) {
    if (error.code === "23514") return { ok: false, message: "Debe ser un usuario de Comunicación o administrador." };
    return fail(error, "guardar el escalamiento");
  }
  revalidatePath(PATH);
  return { ok: true, message: parsed.data.userId ? "Los turnos vencidos se escalarán a esta persona." : "Los turnos vencidos ya no se escalan." };
}

const removeSchema = z.object({ userId: id });

export async function removeContact(input: unknown): Promise<WhatsAppActionResult> {
  const m = await admin();
  if (!m) return FORBIDDEN;
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_whatsapp_contact", { p_org_id: m.orgId, p_user_id: parsed.data.userId });
  if (error) return fail(error, "quitar el número");
  revalidatePath(PATH);
  return { ok: true, message: "Número eliminado. Ya no recibirá mensajes." };
}
