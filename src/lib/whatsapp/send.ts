import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { sendWhatsApp, type OutgoingMessage, type SendResult } from "./client";

/** Sends a message and records it in whatsapp_messages (also when it fails). */
export async function sendAndLog(
  admin: SupabaseClient<Database>,
  target: { orgId: string | null; contactId: string | null; phone: string; ticketId?: string | null },
  message: OutgoingMessage,
): Promise<SendResult> {
  const result = await sendWhatsApp(target.phone, message, { env: process.env, fetch });
  if (result.ok || !result.notConfigured) {
    const { error } = await admin.from("whatsapp_messages").insert({
      org_id: target.orgId,
      contact_id: target.contactId,
      direction: "out",
      wa_message_id: result.ok ? result.waId : null,
      kind: message.kind === "buttons" ? "interactive" : message.kind,
      template: message.kind === "template" ? message.template : null,
      body: (message.kind === "template" ? message.summary : message.text).slice(0, 500),
      status: result.ok ? "sent" : "failed",
      error: result.ok ? null : result.error,
      ticket_id: target.ticketId ?? null,
    });
    if (error) console.error("[whatsapp] log out:", error.code, error.message);
  }
  return result;
}

