import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeliveryResult } from "@/lib/notify";
import type { AlertMessage } from "@/lib/notify/types";
import type { Database } from "@/lib/supabase/database.types";
import { alertNotice } from "./alert-message";
import { whatsappConfigured } from "./client";
import { sendAndLog } from "./send";

/**
 * Sends an alert to the rule's WhatsApp recipients (members of the org).
 * Only those who accepted WhatsApp messages receive it; the rest are counted
 * as skipped.
 */
export async function sendAlertWhatsApp(
  admin: SupabaseClient<Database>,
  orgId: string,
  userIds: string[],
  message: AlertMessage,
): Promise<DeliveryResult> {
  if (!userIds.length) return { status: "skipped" };
  if (!whatsappConfigured(process.env)) return { status: "not_configured", detail: "WhatsApp no está configurado." };
  const { data: contacts } = await admin
    .from("whatsapp_contacts")
    .select("id, phone")
    .eq("org_id", orgId)
    .eq("status", "active")
    .in("user_id", userIds);
  if (!contacts?.length) return { status: "skipped", detail: "Ningún destinatario ha aceptado WhatsApp." };

  const notice = alertNotice(message);
  const failures: string[] = [];
  for (const c of contacts) {
    const sent = await sendAndLog(admin, { orgId, contactId: c.id, phone: c.phone }, notice);
    if (!sent.ok) failures.push(sent.error);
  }
  const missing = userIds.length - contacts.length;
  const note = missing > 0 ? `${missing} sin WhatsApp activo.` : undefined;
  if (failures.length === contacts.length) return { status: "failed", detail: failures.join("; ").slice(0, 300) };
  if (failures.length) return { status: "sent", detail: `${failures.length} de ${contacts.length} fallaron.${note ? ` ${note}` : ""}` };
  return note ? { status: "sent", detail: note } : { status: "sent" };
}
