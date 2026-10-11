import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { admin, login, toast, USERS } from "./helpers";

// Locally and in CI the Graph API is e2e/mock-anthropic.mjs and the app has
// WHATSAPP_APP_SECRET=E2E_WHATSAPP_APP_SECRET; against a preview without
// WhatsApp the invitation is only registered and the webhook part is skipped.
const SECRET = process.env.E2E_WHATSAPP_APP_SECRET;
const PHONE_NUMBER_ID = process.env.E2E_WHATSAPP_PHONE_NUMBER_ID ?? "PN_E2E";
const OBRAS = "00000000-0000-4000-b000-000000000001";
const OBRAS_USER = "00000000-0000-4000-d000-000000000003";
const PHONE = "525500000001";
const MOCK = process.env.E2E_WHATSAPP_MOCK_URL ?? "http://127.0.0.1:4010/whatsapp/sent";

/** A delivery from Meta's webhook, signed like Meta does. */
function fromMeta(request: APIRequestContext, message: Record<string, unknown>) {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              messages: [{ id: `wamid.e2e-${Date.now()}-${Math.random()}`, from: "5215500000001", ...message }],
            },
          },
        ],
      },
    ],
  });
  const signature = `sha256=${createHmac("sha256", SECRET!).update(body).digest("hex")}`;
  return request.post("/api/whatsapp/webhook", { data: body, headers: { "content-type": "application/json", "x-hub-signature-256": signature } });
}

type Sent = { id: string; to: string; type: string; text?: { body: string }; template?: { name: string; components: { parameters: { payload?: string }[] }[] } };
const sentTo = async (request: APIRequestContext): Promise<Sent[]> =>
  ((await (await request.get(MOCK)).json()) as Sent[]).filter((m) => m.to === PHONE);

const live = (page: import("@playwright/test").Page) => page.getByText("En vivo", { exact: true }).waitFor({ timeout: 20_000 });

async function cleanUp() {
  const db = admin();
  await db.from("departments").update({ responsible_user_id: null }).eq("id", OBRAS);
  const { data: contact } = await db.from("whatsapp_contacts").select("id").eq("user_id", OBRAS_USER).maybeSingle();
  if (contact) {
    await db.from("whatsapp_messages").delete().eq("contact_id", contact.id);
    await db.from("whatsapp_contacts").delete().eq("id", contact.id);
  }
}

test.describe("WhatsApp y SLA", () => {
  test.beforeEach(cleanUp);
  test.afterEach(cleanUp);

  test("admin changes the SLA, keeping higher priorities faster", async ({ page }) => {
    const db = admin();
    const { data: org } = await db.from("departments").select("org_id").eq("id", OBRAS).single();
    const { data: before } = await db.from("sla_policies").select("hours").eq("org_id", org!.org_id).eq("priority", "critical").single();
    try {
      await login(page, USERS.admin, "/configuracion/whatsapp");
      const critical = page.getByLabel("Prioridad crítica");
      await critical.fill("4");
      await page.getByRole("button", { name: "Guardar SLA" }).click();
      await expect(toast(page, "SLA actualizado")).toBeVisible();

      await critical.fill("100");
      await page.getByRole("button", { name: "Guardar SLA" }).click();
      await expect(toast(page, "Una prioridad mayor debe tener un plazo igual o menor")).toBeVisible();
    } finally {
      await db.from("sla_policies").update({ hours: before!.hours }).eq("org_id", org!.org_id).eq("priority", "critical");
    }
  });

  test("admin names a responsible, invites them and they accept on WhatsApp", async ({ page, request }) => {
    await login(page, USERS.admin, "/configuracion/whatsapp");
    const row = page.getByRole("row").filter({ has: page.getByRole("combobox", { name: "Responsable de Obras Públicas" }) });

    await row.getByRole("combobox", { name: "Responsable de Obras Públicas" }).click();
    await page.getByRole("option", { name: USERS.obras }).click();
    await expect(toast(page, "Responsable de Obras Públicas asignado")).toBeVisible();

    await row.getByLabel("WhatsApp del responsable de Obras Públicas").fill("55 0000 0001");
    await row.getByRole("button", { name: "Invitar" }).click();
    await expect(toast(page, /Invitación enviada a \+52 55 0000 0001|Número \+52 55 0000 0001 registrado/)).toBeVisible();
    await expect(row.getByText("Invitación enviada")).toBeVisible();

    test.skip(!SECRET, "Sin E2E_WHATSAPP_APP_SECRET: el webhook firmado sólo se prueba con el simulador.");

    // Unsigned or forged deliveries are rejected.
    const forged = await request.post("/api/whatsapp/webhook", { data: { object: "whatsapp_business_account", entry: [] } });
    expect(forged.status()).toBe(401);

    const accept = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                // Mexican mobiles arrive with the legacy "1" after 52.
                messages: [{ id: `wamid.e2e-${Date.now()}`, from: "5215500000001", type: "button", button: { payload: "invite:accept", text: "Acepto" } }],
              },
            },
          ],
        },
      ],
    });
    const signature = `sha256=${createHmac("sha256", SECRET!).update(accept).digest("hex")}`;
    const post = () => request.post("/api/whatsapp/webhook", { data: accept, headers: { "content-type": "application/json", "x-hub-signature-256": signature } });
    expect((await post()).status()).toBe(200);
    // Meta retries: the same message is processed once.
    expect((await post()).status()).toBe(200);

    await page.reload();
    await expect(row.getByText("Activo")).toBeVisible();
    const { data: contact } = await admin().from("whatsapp_contacts").select("phone, status, confirmed_at").eq("user_id", OBRAS_USER).single();
    expect(contact).toMatchObject({ phone: PHONE, status: "active" });
    expect(contact!.confirmed_at).not.toBeNull();

    // The log shows the invitation, the answer and one confirmation.
    const messages = page.getByRole("row").filter({ hasText: /Invitación: .*Obras Públicas|Acepto|Quedaste como responsable de Obras Públicas/ });
    await expect(messages).toHaveCount(3);
  });

  test("the responsible gets the routed mention on WhatsApp and works it from there", async ({ page, request }) => {
    test.skip(!SECRET, "Sin E2E_WHATSAPP_APP_SECRET: el aviso y los botones sólo se prueban con el simulador.");
    const db = admin();
    const { data: dept } = await db.from("departments").select("org_id").eq("id", OBRAS).single();
    await db.from("departments").update({ responsible_user_id: OBRAS_USER }).eq("id", OBRAS);
    const { data: contact } = await db
      .from("whatsapp_contacts")
      .insert({ org_id: dept!.org_id, user_id: OBRAS_USER, phone: PHONE, status: "active", confirmed_at: new Date().toISOString() })
      .select("id")
      .single();

    await login(page, USERS.comunicacion, "/bandeja?status=new");
    await live(page);
    const first = page.locator("article[data-mention-id]").first();
    const target = (await first.getAttribute("data-mention-id"))!;
    const { data: before } = await db.from("mentions").select("triage").eq("id", target).single();
    try {
      await first.click();
      await page.locator("body").press("t");
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("combobox", { name: "Dependencia" }).click();
      await page.getByRole("option", { name: "Obras Públicas" }).click();
      await dialog.getByRole("button", { name: "Turnar" }).click();
      await expect(toast(page, "Se avisará al responsable por WhatsApp")).toBeVisible();

      // The notice goes out after the response, with the ticket's buttons.
      const { data: ticket } = await db.from("tickets").select("id").eq("mention_id", target).eq("department_id", OBRAS).single();
      await expect.poll(async () => (await db.from("tickets").select("whatsapp_notified_at").eq("id", ticket!.id).single()).data?.whatsapp_notified_at).not.toBeNull();
      const notice = (await sentTo(request)).findLast((m) => m.template?.name === "sigma_turno");
      expect(notice!.template!.components.slice(1).map((c) => c.parameters[0].payload)).toEqual(
        ["in_progress", "resolved", "detail"].map((a) => `ticket:${ticket!.id}:${a}`),
      );

      // "Resuelto" closes it as the official, with a WhatsApp note.
      expect((await fromMeta(request, { type: "button", button: { payload: `ticket:${ticket!.id}:resolved`, text: "Resuelto" } })).status()).toBe(200);
      const { data: resolved } = await db.from("tickets").select("status").eq("id", ticket!.id).single();
      expect(resolved!.status).toBe("resolved");
      expect((await sentTo(request)).at(-1)!.text!.body).toMatch(/quedó «Resuelto»/);

      // A reply to the notice becomes a note; "Ver detalle" answers with the link.
      await fromMeta(request, { type: "text", text: { body: "Cuadrilla atendió el reporte" }, context: { id: notice!.id } });
      await fromMeta(request, { type: "button", button: { payload: `ticket:${ticket!.id}:detail`, text: "Ver detalle" } });
      expect((await sentTo(request)).at(-1)!.text!.body).toContain(`/bandeja?mention=${target}`);

      await page.goto(`/bandeja?mention=${target}&status=all`);
      const aside = page.locator('aside[aria-label="Detalle de la mención"]');
      await live(page);
      await page.locator(`article[data-mention-id="${target}"]`).first().click();
      await expect(aside.getByText(/Avisado por WhatsApp/)).toBeVisible();
      await expect(aside.getByText("Cuadrilla atendió el reporte")).toBeVisible();
      await expect(aside.getByText("Cambió el turno a «Resuelto» desde WhatsApp.")).toBeVisible();
      await expect(aside.getByText(/por WhatsApp/).first()).toBeVisible();
    } finally {
      await db.from("whatsapp_messages").delete().eq("contact_id", contact!.id);
      await db.from("tickets").delete().eq("mention_id", target).eq("department_id", OBRAS);
      await db.from("mention_notes").delete().eq("mention_id", target).eq("channel", "whatsapp");
      if (before) await db.from("mentions").update({ triage: before.triage }).eq("id", target);
    }
  });
});
