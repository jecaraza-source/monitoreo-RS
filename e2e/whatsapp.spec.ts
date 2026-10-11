import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { admin, login, toast, USERS } from "./helpers";

// Locally and in CI the Graph API is e2e/mock-anthropic.mjs and the app has
// WHATSAPP_APP_SECRET=E2E_WHATSAPP_APP_SECRET; against a preview without
// WhatsApp the invitation is only registered and the webhook part is skipped.
const SECRET = process.env.E2E_WHATSAPP_APP_SECRET;
const PHONE_NUMBER_ID = process.env.E2E_WHATSAPP_PHONE_NUMBER_ID ?? "PN_E2E";
const OBRAS = "00000000-0000-4000-b000-000000000001";
const OBRAS_USER = "00000000-0000-4000-d000-000000000003";
const PHONE = "525500000001";

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
});
