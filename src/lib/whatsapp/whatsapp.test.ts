import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requestBody, sendWhatsApp } from "./client.ts";
import { decide, INVITE_ACCEPT, INVITE_DECLINE, keyword, parseTicketPayload, replyText, ticketPayload } from "./conversation.ts";
import { alertNotice } from "./alert-message.ts";
import {
  actionText,
  detailMessage,
  detailText,
  escalationNotice,
  folio,
  isQuietHour,
  oneLine,
  pendingText,
  reminderNotice,
  turnNotice,
} from "./turn-message.ts";
import { formatPhone, maskPhone, normalizePhone } from "./phone.ts";
import { parseWebhook, previousStatuses, signBody, verifyChallenge, verifySignature } from "./webhook.ts";

describe("phone numbers", () => {
  it("normalizes what people type and what Meta sends to one form", () => {
    assert.equal(normalizePhone("+52 56 2133 9211"), "525621339211");
    assert.equal(normalizePhone("(56) 2133-9211"), "525621339211");
    assert.equal(normalizePhone("5621339211"), "525621339211");
    assert.equal(normalizePhone("+5215621339211"), "525621339211");
    assert.equal(normalizePhone("0052 56 2133 9211"), "525621339211");
    assert.equal(normalizePhone("+1 415 555 0100"), "14155550100");
    assert.equal(normalizePhone("12345"), null);
    assert.equal(normalizePhone("55-ABC"), null);
  });

  it("formats and masks", () => {
    assert.equal(formatPhone("525621339211"), "+52 56 2133 9211");
    assert.equal(maskPhone("525621339211"), "+52 56 •••• 9211");
  });
});

describe("webhook", () => {
  const secret = "app-secret";

  it("accepts only bodies signed with the app secret", () => {
    const body = '{"object":"whatsapp_business_account"}';
    assert.equal(verifySignature(body, signBody(body, secret), secret), true);
    assert.equal(verifySignature(body + " ", signBody(body, secret), secret), false);
    assert.equal(verifySignature(body, signBody(body, "other"), secret), false);
    assert.equal(verifySignature(body, null, secret), false);
    assert.equal(verifySignature(body, "sha256=zz", secret), false);
  });

  it("answers the subscription handshake only with the right token", () => {
    const params = (token: string) => new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "42" });
    assert.equal(verifyChallenge(params("tok"), "tok"), "42");
    assert.equal(verifyChallenge(params("bad"), "tok"), null);
    assert.equal(verifyChallenge(params("tok"), undefined), null);
  });

  it("extracts messages and statuses for our number only", () => {
    const value = (phoneNumberId: string) => ({
      metadata: { phone_number_id: phoneNumberId },
      messages: [
        { id: "wamid.1", from: "5215621339211", timestamp: "1760000000", type: "button", button: { payload: INVITE_ACCEPT, text: "Acepto" }, context: { id: "wamid.0" } },
        { id: "wamid.2", from: "5215621339211", type: "text", text: { body: "  baja " } },
        { id: "wamid.3", from: "5215621339211", type: "image" },
      ],
      statuses: [
        { id: "wamid.0", status: "read", timestamp: "1760000001" },
        { id: "wamid.9", status: "failed", errors: [{ code: 131026, title: "Message undeliverable" }] },
        { id: "wamid.8", status: "deleted" },
      ],
    });
    const body = {
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: value("PN1") }, { field: "messages", value: value("OTHER") }] }],
    };
    const events = parseWebhook(body, "PN1")!;
    assert.equal(events.messages.length, 3);
    assert.deepEqual(
      { ...events.messages[0], at: events.messages[0].at.toISOString() },
      { waId: "wamid.1", from: "525621339211", kind: "button", text: "Acepto", payload: INVITE_ACCEPT, replyTo: "wamid.0", at: "2025-10-09T08:53:20.000Z" },
    );
    assert.equal(events.messages[1].text, "baja");
    assert.equal(events.messages[2].kind, "other");
    assert.deepEqual(events.statuses.map((s) => [s.waId, s.status, s.error]), [
      ["wamid.0", "read", null],
      ["wamid.9", "failed", "131026 Message undeliverable"],
    ]);
    assert.equal(parseWebhook({ object: "page", entry: [] }, "PN1"), null);
    assert.equal(parseWebhook("nonsense", "PN1"), null);
  });

  it("moves delivery statuses only forward", () => {
    assert.deepEqual(previousStatuses("read"), ["sent", "delivered"]);
    assert.deepEqual(previousStatuses("delivered"), ["sent"]);
    assert.deepEqual(previousStatuses("sent"), []);
  });
});

describe("conversation", () => {
  const url = "https://pulso.example";
  const contact = (status: "pending" | "active" | "declined" | "opted_out") => ({ status, departments: ["Obras Públicas"] });
  const msg = (text: string, payload: string | null = null) => ({ text, payload });

  it("activates on the Acepto button or text and declines on No acepto", () => {
    assert.deepEqual(decide(contact("pending"), msg("Acepto", INVITE_ACCEPT), url), { next: "active", reply: { kind: "accepted", departments: ["Obras Públicas"] } });
    assert.equal(decide(contact("pending"), msg("¡Sí, acepto!"), url).next, "active");
    assert.equal(decide(contact("pending"), msg("No acepto", INVITE_DECLINE), url).next, "declined");
    assert.equal(decide(contact("declined"), msg("acepto"), url).next, "active");
    assert.deepEqual(decide(contact("pending"), msg("hola"), url), { next: null, reply: { kind: "pending_help" } });
  });

  it("honors BAJA from any state and ALTA after it", () => {
    assert.equal(decide(contact("active"), msg("BAJA"), url).next, "opted_out");
    assert.equal(decide(contact("pending"), msg("baja."), url).next, "opted_out");
    assert.deepEqual(decide(contact("opted_out"), msg("baja"), url), { next: null, reply: { kind: "none" } });
    assert.deepEqual(decide(contact("opted_out"), msg("hola"), url), { next: null, reply: { kind: "none" } });
    assert.equal(decide(contact("opted_out"), msg("Alta"), url).next, "active");
  });

  it("never engages numbers of no official beyond a fixed notice", () => {
    const d = decide(null, msg("Hay un bache en mi calle"), url);
    assert.deepEqual(d, { next: null, reply: { kind: "unknown_number" } });
    assert.match(replyText(d.reply)!, /exclusivo para funcionarios/);
  });

  it("points active officials to the app and writes replies in Spanish", () => {
    const d = decide(contact("active"), msg("¿qué tengo pendiente?"), url);
    assert.match(replyText(d.reply)!, /https:\/\/pulso\.example\/bandeja/);
    assert.match(replyText({ kind: "accepted", departments: ["Obras", "Agua", "Limpia"] })!, /Obras, Agua y Limpia/);
    assert.equal(replyText({ kind: "none" }), null);
    assert.equal(keyword("¡Sí, ACEPTO!"), "si acepto");
  });
});

describe("client", () => {
  it("builds template requests with parameters and quick-reply payloads", () => {
    const body = requestBody("525621339211", { kind: "template", template: "sigma_vinculacion", params: ["Ana", "Alvarado", "Obras"], buttons: [INVITE_ACCEPT, INVITE_DECLINE], summary: "" });
    assert.deepEqual(body.template?.components, [
      { type: "body", parameters: [{ type: "text", text: "Ana" }, { type: "text", text: "Alvarado" }, { type: "text", text: "Obras" }] },
      { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: INVITE_ACCEPT }] },
      { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: INVITE_DECLINE }] },
    ]);
    assert.equal(body.template?.language.code, "es_MX");
  });

  it("returns Meta's message id, or why it could not send", async () => {
    let url = "";
    const ok = await sendWhatsApp("525621339211", { kind: "text", text: "hola" }, {
      env: { WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "PN1", WHATSAPP_API_URL: "http://mock/whatsapp/" },
      fetch: (async (u: string) => {
        url = u;
        return new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }));
      }) as unknown as typeof fetch,
    });
    assert.deepEqual(ok, { ok: true, waId: "wamid.X" });
    assert.equal(url, "http://mock/whatsapp/PN1/messages");

    const missing = await sendWhatsApp("525621339211", { kind: "text", text: "hola" }, { env: {}, fetch });
    assert.equal(missing.ok === false && missing.notConfigured, true);

    const rejected = await sendWhatsApp("525621339211", { kind: "text", text: "hola" }, {
      env: { WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "PN1" },
      fetch: (async () => new Response(JSON.stringify({ error: { message: "Template not approved" } }), { status: 400 })) as unknown as typeof fetch,
    });
    assert.deepEqual(rejected, { ok: false, error: "WhatsApp 400: Template not approved" });
  });
});

describe("turns", () => {
  const ticketId = "a1b2c3d4-0000-4000-8000-000000000001";
  const turn = {
    ticketId,
    department: "Obras Públicas",
    text: "Hay un socavón\n\nen la calle   Juárez,\tfrente a la escuela",
    priority: "high" as const,
    dueAt: "2026-10-12T20:00:00Z",
  };

  it("reads ticket buttons and only well-formed ones", () => {
    assert.deepEqual(parseTicketPayload(ticketPayload(ticketId, "resolved")), { ticketId, action: "resolved" });
    assert.equal(parseTicketPayload("ticket:not-a-uuid:resolved"), null);
    assert.equal(parseTicketPayload(`ticket:${ticketId}:closed`), null);
    assert.equal(parseTicketPayload(null), null);
  });

  it("routes buttons and replies of active officials", () => {
    const active = { status: "active" as const, departments: ["Obras"] };
    assert.deepEqual(decide(active, { text: "Resuelto", payload: ticketPayload(ticketId, "resolved") }, "u").reply, {
      kind: "ticket_action",
      ticketId,
      action: "resolved",
    });
    assert.deepEqual(decide(active, { text: "Ya se atendió", payload: null, replyTo: "wamid.N" }, "u").reply, {
      kind: "note",
      replyTo: "wamid.N",
      text: "Ya se atendió",
    });
    assert.equal(decide(active, { text: "Ya se atendió", payload: null }, "u").reply.kind, "help");
    // A pending official cannot work tickets yet.
    assert.equal(decide({ ...active, status: "pending" }, { text: "Resuelto", payload: ticketPayload(ticketId, "resolved") }, "u").reply.kind, "pending_help");
  });

  it("builds the notice with one-line parameters and three buttons", () => {
    const notice = turnNotice(turn);
    assert.equal(notice.kind, "template");
    if (notice.kind !== "template") return;
    assert.equal(notice.template, "sigma_turno");
    assert.equal(notice.params[0], "Obras Públicas");
    assert.equal(notice.params[1], "A1B2C3");
    assert.equal(notice.params[2], "Hay un socavón en la calle Juárez, frente a la escuela");
    assert.equal(notice.params[3], "Alta");
    assert.match(notice.params[4], /lun 12 de oct, 02:00/);
    assert.deepEqual(notice.buttons, ["in_progress", "resolved", "detail"].map((a) => `ticket:${ticketId}:${a}`));
    assert.equal(oneLine("x".repeat(300), 10), "xxxxxxxxx…");
  });

  it("writes the detail and the answers to each action", () => {
    const text = detailText(
      { ...turn, status: "open", mentionId: "m1", source: "Facebook", publishedAt: "2026-10-11T15:00:00Z", neighborhood: "Centro", url: null },
      "https://pulso.example",
    );
    assert.match(text, /^Turno A1B2C3 · Obras Públicas/);
    assert.match(text, /Colonia: Centro/);
    assert.match(text, /https:\/\/pulso\.example\/bandeja\?mention=m1/);
    assert.equal(actionText(ticketId, { ok: true, status: "resolved" }, "status"), "Listo: el turno A1B2C3 quedó «Resuelto».");
    assert.equal(actionText(ticketId, { ok: true, status: "open" }, "note"), "Nota agregada al turno A1B2C3.");
    assert.match(actionText(ticketId, { ok: false, reason: "forbidden" }, "status"), /ya no está asignado/);
    assert.equal(folio(ticketId), "A1B2C3");
  });

  it("answers PENDIENTES and folios of active officials only", () => {
    const active = { status: "active" as const, departments: ["Obras"] };
    assert.deepEqual(decide(active, { text: "Pendientes", payload: null }, "u").reply, { kind: "pending_list" });
    assert.deepEqual(decide(active, { text: "mis turnos", payload: null }, "u").reply, { kind: "pending_list" });
    assert.deepEqual(decide(active, { text: "a1b2c3", payload: null }, "u").reply, { kind: "ticket_lookup", folio: "A1B2C3" });
    assert.deepEqual(decide(active, { text: "Folio A1B2C3", payload: null }, "u").reply, { kind: "ticket_lookup", folio: "A1B2C3" });
    assert.equal(decide(active, { text: "A1B2C3 ya quedó", payload: null }, "u").reply.kind, "help");
    assert.equal(decide({ ...active, status: "pending" }, { text: "pendientes", payload: null }, "u").reply.kind, "pending_help");
    assert.match(replyText({ kind: "help", url: "https://pulso.example" })!, /PENDIENTES/);
  });

  it("builds reminders, expired notices and escalations", () => {
    const reminder = reminderNotice({ ...turn, status: "in_progress" }, false);
    assert.equal(reminder.kind, "template");
    if (reminder.kind !== "template") return;
    assert.equal(reminder.template, "sigma_recordatorio");
    assert.equal(reminder.params[0], "A1B2C3");
    assert.equal(reminder.params[1], "Obras Públicas");
    assert.equal(reminder.params[2], "sigue en proceso y está por vencer");
    assert.match(reminder.params[3], /^lun 12 de oct/);
    assert.equal(reminder.buttons?.length, 3);
    assert.ok(reminder.params.every((p) => !p.includes("\n")));

    const expired = reminderNotice({ ...turn, status: "open" }, true);
    assert.ok(expired.kind === "template" && expired.params[2] === "sigue abierto y ya venció" && expired.summary.startsWith("Turno vencido"));

    const escalation = escalationNotice({ ...turn, status: "open" });
    assert.ok(escalation.kind === "template");
    if (escalation.kind !== "template") return;
    assert.equal(escalation.template, "sigma_escalamiento");
    assert.deepEqual(escalation.params.slice(0, 3), ["Obras Públicas", "A1B2C3", "alta"]);
    assert.deepEqual(escalation.buttons, [`ticket:${ticketId}:detail`]);
  });

  it("lists pending turns and sends details with buttons", () => {
    const now = new Date("2026-10-12T21:00:00Z");
    const text = pendingText([{ ...turn, status: "open" }], 3, "https://pulso.example", now);
    assert.match(text, /^Tienes 3 turnos pendientes \(los 1 más urgentes\):/);
    assert.match(text, /1\. A1B2C3 · Obras Públicas · Alta · Abierto/);
    assert.match(text, /⚠️ vencido/);
    assert.match(pendingText([], 0, "https://pulso.example", now), /No tienes turnos pendientes/);

    const base = { ...turn, mentionId: "m1", source: null, publishedAt: "2026-10-11T15:00:00Z", neighborhood: null, url: null };
    const open = detailMessage({ ...base, status: "open" }, "https://pulso.example");
    assert.equal(open.kind, "buttons");
    if (open.kind !== "buttons") return;
    assert.deepEqual(open.buttons.map((b) => b.title), ["En proceso", "Resuelto"]);
    assert.ok(open.text.length <= 1024);
    assert.equal(detailMessage({ ...base, status: "resolved" }, "u").kind, "text");

    const body = requestBody("525621339211", open) as { type: string; interactive: { action: { buttons: { reply: { id: string } }[] } } };
    assert.equal(body.type, "interactive");
    assert.equal(body.interactive.action.buttons[1].reply.id, `ticket:${ticketId}:resolved`);
  });

  it("keeps reminders out of the night in Mexico City", () => {
    assert.equal(isQuietHour(new Date("2026-10-12T04:30:00Z")), true); // 22:30
    assert.equal(isQuietHour(new Date("2026-10-12T12:59:00Z")), true); // 06:59
    assert.equal(isQuietHour(new Date("2026-10-12T13:00:00Z")), false); // 07:00
    assert.equal(isQuietHour(new Date("2026-10-12T21:00:00Z")), false); // 15:00
    assert.equal(isQuietHour(new Date("2026-10-12T04:30:00Z"), "off"), false);
    assert.equal(isQuietHour(new Date("2026-10-12T20:00:00Z"), "14-16"), true); // 14:00
  });
});

describe("WhatsApp alerts", () => {
  it("fills the alert template in one line per parameter", () => {
    const notice = alertNotice({
      title: "Pico de menciones: 50 en 1 hora",
      summary: "Lo normal es 5.\nRevisa el tablero.",
      severity: "critical",
      ruleName: "Pico",
      orgName: "Alvarado",
      url: "https://pulso.example/alertas?alerta=1",
    });
    assert.ok(notice.kind === "template");
    if (notice.kind !== "template") return;
    assert.equal(notice.template, "sigma_alerta");
    assert.deepEqual(notice.params, ["Alvarado", "Pico de menciones: 50 en 1 hora", "Lo normal es 5. Revisa el tablero.", "crítica", "https://pulso.example/alertas?alerta=1"]);
  });
});
