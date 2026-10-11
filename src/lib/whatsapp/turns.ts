import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { siteUrl } from "@/lib/site-url";
import type { Database } from "@/lib/supabase/database.types";
import { whatsappConfigured } from "./client";
import type { TicketAction } from "./conversation";
import { sendAndLog } from "./send";
import { actionText, detailText, turnNotice, type ActionResult, type TurnDetail } from "./turn-message";

type Admin = SupabaseClient<Database>;

/** Routing many mentions at once notifies the first ones; the rest are in the inbox. */
export const MAX_NOTICES_PER_ROUTING = 10;

async function turnDetails(admin: Admin, ticketIds: string[]): Promise<(TurnDetail & { departmentId: string; orgId: string })[]> {
  if (!ticketIds.length) return [];
  const { data: tickets } = await admin
    .from("tickets")
    .select("id, org_id, mention_id, department_id, status, due_at")
    .in("id", ticketIds);
  if (!tickets?.length) return [];
  const mentionIds = tickets.map((t) => t.mention_id);
  const [mentions, classifications, departments] = await Promise.all([
    admin.from("mentions").select("id, text, url, published_at, source_id").in("id", mentionIds),
    admin.from("classifications").select("mention_id, priority, neighborhood_id").in("mention_id", mentionIds),
    admin.from("departments").select("id, name").in("id", [...new Set(tickets.map((t) => t.department_id))]),
  ]);
  const mentionById = new Map((mentions.data ?? []).map((m) => [m.id, m]));
  const classByMention = new Map((classifications.data ?? []).map((c) => [c.mention_id, c]));
  const hoodIds = [...new Set((classifications.data ?? []).map((c) => c.neighborhood_id).filter((x): x is string => Boolean(x)))];
  const sourceIds = [...new Set((mentions.data ?? []).map((m) => m.source_id))];
  const [hoods, sources] = await Promise.all([
    hoodIds.length ? admin.from("neighborhoods").select("id, name").in("id", hoodIds) : Promise.resolve({ data: [] }),
    admin.from("sources").select("id, name").in("id", sourceIds),
  ]);
  const name = (rows: { id: string; name: string }[] | null) => new Map((rows ?? []).map((r) => [r.id, r.name]));
  const deptName = name(departments.data);
  const hoodName = name(hoods.data);
  const sourceName = name(sources.data);

  return tickets.flatMap((t) => {
    const m = mentionById.get(t.mention_id);
    if (!m) return [];
    const c = classByMention.get(t.mention_id);
    return [
      {
        ticketId: t.id,
        orgId: t.org_id,
        departmentId: t.department_id,
        department: deptName.get(t.department_id) ?? "tu dependencia",
        text: m.text,
        priority: c?.priority ?? "medium",
        dueAt: t.due_at,
        status: t.status,
        mentionId: m.id,
        source: sourceName.get(m.source_id) ?? null,
        publishedAt: m.published_at,
        neighborhood: c?.neighborhood_id ? (hoodName.get(c.neighborhood_id) ?? null) : null,
        url: m.url,
      },
    ];
  });
}

/**
 * Sends the turn notice to each department's responsible with an active
 * WhatsApp. Tickets already notified are skipped, so re-routing the same
 * mention to the same department does not notify twice.
 */
export async function notifyRoutedTickets(admin: Admin, ticketIds: string[]): Promise<number> {
  if (!whatsappConfigured(process.env) || !ticketIds.length) return 0;
  const { data: pending } = await admin
    .from("tickets")
    .select("id")
    .in("id", ticketIds)
    .is("whatsapp_notified_at", null)
    .limit(MAX_NOTICES_PER_ROUTING);
  const details = await turnDetails(admin, (pending ?? []).map((t) => t.id));
  if (!details.length) return 0;

  const deptIds = [...new Set(details.map((d) => d.departmentId))];
  const { data: departments } = await admin.from("departments").select("id, responsible_user_id").in("id", deptIds);
  const responsible = new Map((departments ?? []).map((d) => [d.id, d.responsible_user_id]));
  const userIds = [...new Set((departments ?? []).map((d) => d.responsible_user_id).filter((x): x is string => Boolean(x)))];
  if (!userIds.length) return 0;
  const { data: contacts } = await admin
    .from("whatsapp_contacts")
    .select("id, org_id, user_id, phone")
    .in("user_id", userIds)
    .eq("status", "active");

  let sent = 0;
  for (const d of details) {
    const userId = responsible.get(d.departmentId);
    const contact = (contacts ?? []).find((c) => c.user_id === userId && c.org_id === d.orgId);
    if (!contact) continue;
    const result = await sendAndLog(admin, { orgId: d.orgId, contactId: contact.id, phone: contact.phone, ticketId: d.ticketId }, turnNotice(d));
    if (result.ok) {
      sent++;
      await admin.from("tickets").update({ whatsapp_notified_at: new Date().toISOString() }).eq("id", d.ticketId);
    }
  }
  return sent;
}

type Contact = { id: string; org_id: string; phone: string };

/** A status button or "Ver detalle" from the turn notice. */
export async function handleTicketButton(admin: Admin, contact: Contact, ticketId: string, action: TicketAction): Promise<string> {
  if (action === "detail") {
    const [detail] = await turnDetails(admin, [ticketId]);
    if (!detail || detail.orgId !== contact.org_id) return actionText(ticketId, { ok: false, reason: "not_found" }, "status");
    return detailText(detail, siteUrl());
  }
  const result = await applyAction(admin, contact.id, ticketId, { p_status: action });
  return actionText(ticketId, result, "status");
}

/** A reply to one of our messages about a ticket becomes a note on it. Null: the message was not about a ticket. */
export async function handleNoteReply(admin: Admin, contact: Contact, replyTo: string, text: string): Promise<{ ticketId: string; reply: string } | null> {
  const { data } = await admin
    .from("whatsapp_messages")
    .select("ticket_id")
    .eq("wa_message_id", replyTo)
    .eq("contact_id", contact.id)
    .not("ticket_id", "is", null)
    .maybeSingle();
  if (!data?.ticket_id) return null;
  const result = await applyAction(admin, contact.id, data.ticket_id, { p_note: text });
  return { ticketId: data.ticket_id, reply: actionText(data.ticket_id, result, "note") };
}

async function applyAction(
  admin: Admin,
  contactId: string,
  ticketId: string,
  args: { p_status?: "in_progress" | "resolved"; p_note?: string },
): Promise<ActionResult> {
  const { data, error } = await admin.rpc("whatsapp_ticket_action", { p_contact_id: contactId, p_ticket_id: ticketId, ...args });
  if (error) throw new Error(`ticket action: ${error.message}`);
  return data as ActionResult;
}
