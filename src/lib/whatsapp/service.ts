import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { siteUrl } from "@/lib/site-url";
import type { Database } from "@/lib/supabase/database.types";
import type { OutgoingMessage } from "./client";
import { decide, replyText, type ContactStatus } from "./conversation";
import { sendAndLog } from "./send";
import { handleNoteReply, handlePendingList, handleTicketButton, handleTicketLookup } from "./turns";
import { previousStatuses, type InboundMessage, type StatusUpdate, type WebhookEvents } from "./webhook";

type Admin = SupabaseClient<Database>;

type ContactRow = { id: string; org_id: string; user_id: string; phone: string; status: ContactStatus };

/**
 * The official behind a number. A live (pending/active) number is unique; a
 * declined or opted-out one may exist in several municipalities, in which
 * case the most recently invited wins.
 */
async function contactFor(admin: Admin, phone: string): Promise<ContactRow | null> {
  const { data } = await admin
    .from("whatsapp_contacts")
    .select("id, org_id, user_id, phone, status, invited_at")
    .eq("phone", phone)
    .order("invited_at", { ascending: false, nullsFirst: false })
    .limit(10);
  const rows = data ?? [];
  return rows.find((c) => c.status === "pending" || c.status === "active") ?? rows[0] ?? null;
}

/** What the official is responsible for, as named in the replies. */
async function departmentsOf(admin: Admin, contact: ContactRow): Promise<string[]> {
  const [{ data }, { data: settings }] = await Promise.all([
    admin.from("departments").select("name").eq("org_id", contact.org_id).eq("responsible_user_id", contact.user_id).order("name"),
    admin.from("whatsapp_settings").select("escalation_user_id").eq("org_id", contact.org_id).maybeSingle(),
  ]);
  const names = (data ?? []).map((d) => d.name);
  return settings?.escalation_user_id === contact.user_id ? [...names, "seguimiento de turnos vencidos"] : names;
}

const STAMP: Partial<Record<ContactStatus, "confirmed_at" | "opted_out_at">> = { active: "confirmed_at", opted_out: "opted_out_at" };

async function handleMessage(admin: Admin, message: InboundMessage) {
  const contact = await contactFor(admin, message.from);

  // Recorded first: the unique wamid makes a webhook retry a no-op. Numbers of
  // no official are logged without number or text (they may be citizens).
  const { data: logged, error } = await admin
    .from("whatsapp_messages")
    .upsert(
      {
        org_id: contact?.org_id ?? null,
        contact_id: contact?.id ?? null,
        direction: "in",
        wa_message_id: message.waId,
        kind: message.kind,
        body: contact ? (message.text || message.payload || "").slice(0, 500) || null : null,
        status: "received",
        status_at: message.at.toISOString(),
        created_at: message.at.toISOString(),
      },
      { onConflict: "wa_message_id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(`log in: ${error.message}`);
  if (!logged?.length) return; // already processed

  try {
    const departments = contact ? await departmentsOf(admin, contact) : [];
    const decision = decide(contact && { status: contact.status, departments }, message, siteUrl());

    if (contact) {
      const changes: Database["public"]["Tables"]["whatsapp_contacts"]["Update"] = { last_inbound_at: message.at.toISOString() };
      if (decision.next) {
        changes.status = decision.next;
        const stamp = STAMP[decision.next];
        if (stamp) changes[stamp] = new Date().toISOString();
      }
      const { error: updateError } = await admin.from("whatsapp_contacts").update(changes).eq("id", contact.id);
      if (updateError) throw new Error(`contact: ${updateError.message}`);
    }

    const text = replyText(decision.reply);
    let reply: OutgoingMessage | null = text ? { kind: "text", text } : null;
    let ticketId: string | null = null;
    if (contact && decision.reply.kind === "ticket_action") {
      ticketId = decision.reply.ticketId;
      reply = await handleTicketButton(admin, contact, ticketId, decision.reply.action);
    } else if (contact && decision.reply.kind === "note") {
      const note = await handleNoteReply(admin, contact, decision.reply.replyTo, decision.reply.text);
      ticketId = note?.ticketId ?? null;
      reply = { kind: "text", text: note?.reply ?? replyText({ kind: "help", url: siteUrl() })! };
    } else if (contact && decision.reply.kind === "pending_list") {
      reply = { kind: "text", text: await handlePendingList(admin, contact) };
    } else if (contact && decision.reply.kind === "ticket_lookup") {
      const lookup = await handleTicketLookup(admin, contact, decision.reply.folio);
      ticketId = lookup.ticketId;
      reply = lookup.message;
    }
    if (ticketId) await admin.from("whatsapp_messages").update({ ticket_id: ticketId }).eq("id", logged[0].id);

    if (reply) {
      await sendAndLog(admin, { orgId: contact?.org_id ?? null, contactId: contact?.id ?? null, phone: message.from, ticketId }, reply);
    }
  } catch (cause) {
    // Let Meta retry the whole message.
    await admin.from("whatsapp_messages").delete().eq("wa_message_id", message.waId);
    throw cause;
  }
}

async function handleStatus(admin: Admin, update: StatusUpdate) {
  const from = previousStatuses(update.status);
  if (!from.length) return;
  const { error } = await admin
    .from("whatsapp_messages")
    .update({ status: update.status, error: update.error, status_at: update.at.toISOString() })
    .eq("wa_message_id", update.waId)
    .eq("direction", "out")
    .in("status", from);
  if (error) throw new Error(`status: ${error.message}`);
}

export async function handleWebhook(admin: Admin, events: WebhookEvents) {
  for (const status of events.statuses) await handleStatus(admin, status);
  for (const message of events.messages) await handleMessage(admin, message);
}
