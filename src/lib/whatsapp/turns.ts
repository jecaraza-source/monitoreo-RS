import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { siteUrl } from "@/lib/site-url";
import type { Database } from "@/lib/supabase/database.types";
import { whatsappConfigured, type OutgoingMessage } from "./client";
import type { TicketAction } from "./conversation";
import { sendAndLog } from "./send";
import {
  actionText,
  detailMessage,
  escalationNotice,
  isQuietHour,
  pendingText,
  reminderNotice,
  turnNotice,
  type ActionResult,
  type TurnDetail,
} from "./turn-message";

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

type Contact = { id: string; org_id: string; user_id: string; phone: string };

const text = (t: string): OutgoingMessage => ({ kind: "text", text: t });

/** A status button or "Ver detalle" from a turn notice, reminder or detail. */
export async function handleTicketButton(admin: Admin, contact: Contact, ticketId: string, action: TicketAction): Promise<OutgoingMessage> {
  if (action === "detail") {
    const [detail] = await turnDetails(admin, [ticketId]);
    if (!detail || detail.orgId !== contact.org_id) return text(actionText(ticketId, { ok: false, reason: "not_found" }, "status"));
    return detailMessage(detail, siteUrl());
  }
  const result = await applyAction(admin, contact.id, ticketId, { p_status: action });
  return text(actionText(ticketId, result, "status"));
}

// ---------------------------------------------------------------------------
// PENDIENTES and folio lookup
// ---------------------------------------------------------------------------

const OPEN: ("open" | "in_progress")[] = ["open", "in_progress"];
const PENDING_SHOWN = 8;

/** What an official follows: the departments they are responsible for, and every expired turn if they are the escalation contact. */
async function scopeOf(admin: Admin, contact: Contact) {
  const [departments, settings, membership] = await Promise.all([
    admin.from("departments").select("id").eq("org_id", contact.org_id).eq("responsible_user_id", contact.user_id),
    admin.from("whatsapp_settings").select("escalation_user_id").eq("org_id", contact.org_id).maybeSingle(),
    admin.from("memberships").select("role, department_id").eq("org_id", contact.org_id).eq("user_id", contact.user_id).maybeSingle(),
  ]);
  return {
    departmentIds: (departments.data ?? []).map((d) => d.id),
    escalation: settings.data?.escalation_user_id === contact.user_id,
    role: membership.data?.role ?? null,
    ownDepartment: membership.data?.department_id ?? null,
  };
}

/** Reply to PENDIENTES. */
export async function handlePendingList(admin: Admin, contact: Contact, now = new Date()): Promise<string> {
  const scope = await scopeOf(admin, contact);
  const queries = [];
  if (scope.departmentIds.length) {
    queries.push(
      admin
        .from("tickets")
        .select("id, due_at", { count: "exact" })
        .eq("org_id", contact.org_id)
        .in("status", OPEN)
        .in("department_id", scope.departmentIds)
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(PENDING_SHOWN),
    );
  }
  if (scope.escalation) {
    let overdue = admin
      .from("tickets")
      .select("id, due_at", { count: "exact" })
      .eq("org_id", contact.org_id)
      .in("status", OPEN)
      .lte("due_at", now.toISOString())
      .order("due_at", { ascending: true })
      .limit(PENDING_SHOWN);
    if (scope.departmentIds.length) overdue = overdue.not("department_id", "in", `(${scope.departmentIds.join(",")})`);
    queries.push(overdue);
  }
  const results = await Promise.all(queries);
  const rows = results.flatMap((r) => r.data ?? []);
  const total = results.reduce((sum, r) => sum + (r.count ?? 0), 0);
  const ids = rows
    .sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"))
    .slice(0, PENDING_SHOWN)
    .map((r) => r.id);
  const details = await turnDetails(admin, ids);
  const byId = new Map(details.map((d) => [d.ticketId, d]));
  const turns = ids.flatMap((id) => byId.get(id) ?? []);
  return pendingText(turns, total, siteUrl(), now);
}

/** A folio (first 6 characters of the ticket id): its detail, if the official may act on it. */
export async function handleTicketLookup(admin: Admin, contact: Contact, folio: string): Promise<{ ticketId: string | null; message: OutgoingMessage }> {
  const f = folio.toLowerCase();
  const [{ data: tickets }, scope] = await Promise.all([
    admin
      .from("tickets")
      .select("id, department_id")
      .eq("org_id", contact.org_id)
      .gte("id", `${f}00-0000-0000-0000-000000000000`)
      .lte("id", `${f}ff-ffff-ffff-ffff-ffffffffffff`)
      .limit(5),
    scopeOf(admin, contact),
  ]);
  const ticket = (tickets ?? []).find(
    (t) =>
      scope.role === "admin" ||
      scope.role === "comunicacion" ||
      t.department_id === scope.ownDepartment ||
      scope.departmentIds.includes(t.department_id),
  );
  const [detail] = ticket ? await turnDetails(admin, [ticket.id]) : [];
  if (!detail) {
    return { ticketId: null, message: text(`No encontramos el turno ${folio} entre los tuyos. Escribe PENDIENTES para ver tus turnos abiertos.`) };
  }
  return { ticketId: detail.ticketId, message: detailMessage(detail, siteUrl()) };
}

// ---------------------------------------------------------------------------
// Reminders (75% of the deadline) and escalation (expired), from the cron
// ---------------------------------------------------------------------------

export type FollowUpSummary = { skipped?: string; claimed: number; reminders: number; overdue: number; escalations: number; failed: number };

/** Follow-ups claimed per run; the rest go in the next one (every 15 minutes). */
const FOLLOW_UPS_PER_RUN = 25;

export async function sendFollowUps(admin: Admin, now = new Date()): Promise<FollowUpSummary> {
  const summary: FollowUpSummary = { claimed: 0, reminders: 0, overdue: 0, escalations: 0, failed: 0 };
  if (!whatsappConfigured(process.env)) return { ...summary, skipped: "WhatsApp no está configurado." };
  const quiet = process.env.WHATSAPP_QUIET_HOURS ?? "22-7";
  if (isQuietHour(now, quiet)) return { ...summary, skipped: `Horario silencioso (${quiet} h).` };

  const { data: claimed, error } = await admin.rpc("claim_whatsapp_followups", { p_now: now.toISOString(), p_limit: FOLLOW_UPS_PER_RUN });
  if (error) throw new Error(`claim: ${error.message}`);
  summary.claimed = claimed?.length ?? 0;
  if (!claimed?.length) return summary;

  const kindById = new Map(claimed.map((c) => [c.ticket_id, c.kind]));
  const details = await turnDetails(admin, claimed.map((c) => c.ticket_id));
  const orgIds = [...new Set(details.map((d) => d.orgId))];
  const [departments, settings] = await Promise.all([
    admin.from("departments").select("id, responsible_user_id").in("id", [...new Set(details.map((d) => d.departmentId))]),
    admin.from("whatsapp_settings").select("org_id, escalation_user_id").in("org_id", orgIds),
  ]);
  const responsible = new Map((departments.data ?? []).map((d) => [d.id, d.responsible_user_id]));
  const escalation = new Map((settings.data ?? []).map((s) => [s.org_id, s.escalation_user_id]));
  const userIds = [...new Set([...responsible.values(), ...escalation.values()].filter((x): x is string => Boolean(x)))];
  const { data: contacts } = userIds.length
    ? await admin.from("whatsapp_contacts").select("id, org_id, user_id, phone").in("user_id", userIds).in("org_id", orgIds).eq("status", "active")
    : { data: [] };
  const contactOf = (orgId: string, userId: string | null | undefined) =>
    userId ? (contacts ?? []).find((c) => c.org_id === orgId && c.user_id === userId) : undefined;

  for (const d of details) {
    const overdue = kindById.get(d.ticketId) === "overdue";
    const owner = contactOf(d.orgId, responsible.get(d.departmentId));
    if (owner) {
      const sent = await sendAndLog(admin, { orgId: d.orgId, contactId: owner.id, phone: owner.phone, ticketId: d.ticketId }, reminderNotice(d, overdue));
      if (!sent.ok) summary.failed++;
      else if (overdue) summary.overdue++;
      else summary.reminders++;
    }
    const escalate = overdue ? contactOf(d.orgId, escalation.get(d.orgId)) : undefined;
    if (escalate && escalate.id !== owner?.id) {
      const sent = await sendAndLog(admin, { orgId: d.orgId, contactId: escalate.id, phone: escalate.phone, ticketId: d.ticketId }, escalationNotice(d));
      if (sent.ok) summary.escalations++;
      else summary.failed++;
    }
  }
  return summary;
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
