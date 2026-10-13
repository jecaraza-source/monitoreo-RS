import { expect, test } from "@playwright/test";
import { admin, login, toast, USERS } from "./helpers";

// Stage 10: AI quotas that resist concurrency, unknown cost never shown as 0,
// the consumption panel and the catalog of verified authors.
const ORG_A = "00000000-0000-4000-a000-000000000001";
const ADMIN_A = "00000000-0000-4000-d000-000000000001";

type Reservation = { allowed: boolean; call_id: string | null; reason: string | null; message: string | null };

test.describe("cuotas y presupuesto de IA", () => {
  test("reservas simultáneas no exceden la concurrencia ni el presupuesto", async () => {
    const db = admin();
    // The fictitious seed municipality exists locally and in preview; its limits are restored at the end
    // and what it already spent or has in flight is taken into account.
    const { data: previous } = await db.from("ai_limits").select("*").eq("org_id", ORG_A).maybeSingle();
    const started = new Date().toISOString();
    const reserve = (usd: number) =>
      db.rpc("reserve_ai", {
        p_org_id: ORG_A,
        p_user_id: null as unknown as string,
        p_purpose: "report",
        p_model: "claude-opus-5-5",
        p_estimated_usd: usd,
        p_estimated_tokens: 1000,
        p_ttl_seconds: 60,
      });
    const outcome = async (n: number, usd: number) => {
      const results = await Promise.all(Array.from({ length: n }, () => reserve(usd)));
      for (const r of results) expect(r.error).toBeNull();
      return results.map((r) => (r.data as Reservation[])[0]);
    };
    const cleanup = async () => {
      await db.from("ai_calls").delete().eq("org_id", ORG_A).eq("purpose", "report").gte("created_at", started);
    };
    try {
      const inFlight = async () => {
        const { data } = await db.from("ai_calls").select("reserved_usd").eq("org_id", ORG_A).eq("status", "reserved").gt("expires_at", new Date().toISOString());
        return data ?? [];
      };
      // 1) 25 report requests at once against a concurrency of 3: only the free slots pass.
      const before = (await db.from("ai_calls").select("id", { count: "exact", head: true }).eq("org_id", ORG_A).eq("purpose", "report").eq("status", "reserved").gt("expires_at", new Date().toISOString())).count ?? 0;
      await db.from("ai_limits").upsert({ org_id: ORG_A, daily_budget_usd: null, monthly_budget_usd: null, daily_token_budget: null, max_concurrent: { report: 3 }, updated_by: ADMIN_A });
      const first = await outcome(25, 0.01);
      expect(first.filter((r) => r.allowed)).toHaveLength(Math.max(0, 3 - before));
      expect(first.filter((r) => !r.allowed).every((r) => r.reason === "concurrency" && /máximo 3 a la vez/.test(r.message ?? ""))).toBe(true);
      await cleanup();

      // 2) 25 requests of US$0.15 at once against a daily budget US$1.00 above what is spent and in flight.
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
      const { data: spent } = await db.from("ai_usage").select("cost_usd").eq("org_id", ORG_A).eq("day", today);
      const used = (spent ?? []).reduce((s, r) => s + Number(r.cost_usd), 0) + (await inFlight()).reduce((s, r) => s + Number(r.reserved_usd ?? 0), 0);
      const budget = Math.ceil((used + 1) * 100) / 100;
      await db.from("ai_limits").upsert({ org_id: ORG_A, daily_budget_usd: budget, max_concurrent: { report: 50 }, updated_by: ADMIN_A });
      const second = await outcome(25, 0.15);
      expect(second.filter((r) => r.allowed)).toHaveLength(Math.floor((budget - used + 1e-9) / 0.15));
      expect(second.find((r) => !r.allowed)?.message).toMatch(/presupuesto diario de IA/);
      const held = (await inFlight()).reduce((s, r) => s + Number(r.reserved_usd ?? 0), 0);
      expect((spent ?? []).reduce((s, r) => s + Number(r.cost_usd), 0) + held).toBeLessThanOrEqual(budget + 1e-6);
    } finally {
      await cleanup();
      if (previous) await db.from("ai_limits").upsert(previous);
      else await db.from("ai_limits").delete().eq("org_id", ORG_A);
    }
  });

  test("el panel muestra el costo desconocido con sus tokens, nunca como cero, y sólo administración edita", async ({ page }) => {
    const db = admin();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
    const model = `claude-modelo-e2e-${Date.now()}`;
    const { error } = await db.from("ai_usage").insert({
      org_id: ORG_A,
      day: today,
      model,
      purpose: "assistant",
      requests: 3,
      input_tokens: 12_000,
      output_tokens: 800,
      cost_usd: 0,
      unpriced_requests: 3,
      unpriced_tokens: 12_800,
    });
    expect(error).toBeNull();
    try {
      await login(page, USERS.admin, "/configuracion/consumo");
      const main = page.getByRole("main");
      await expect(main.getByRole("alert").filter({ hasText: `Tarifa no configurada para ${model}` })).toBeVisible();
      const row = main.getByRole("table", { name: "Consumo del mes por uso y modelo" }).getByRole("row").filter({ hasText: model });
      await expect(row).toContainText("Costo desconocido");
      await expect(row).toContainText("12,800");
      await expect(row).toContainText("No configurada");
      await expect(row).not.toContainText("US$0.00");
      // Alone it reads "Costo desconocido"; with priced calls, "US$… + 3 solicitudes de costo desconocido".
      const todayTile = main.getByRole("region", { name: /^Hoy/ });
      await expect(todayTile).toContainText(/Costo desconocido|3 solicitudes de costo desconocido/);
      await expect(todayTile).toContainText("12,800 tokens sin tarifa");

      // Admin edits the limits; the value is stored for the org of the session.
      const { data: before } = await db.from("ai_limits").select("*").eq("org_id", ORG_A).maybeSingle();
      try {
        await main.getByLabel("Solicitudes por persona al día").fill("123");
        await main.getByRole("button", { name: "Guardar límites" }).click();
        await expect(toast(page, /Límites guardados/)).toBeVisible();
        expect((await db.from("ai_limits").select("user_daily_requests").eq("org_id", ORG_A).single()).data!.user_daily_requests).toBe(123);
      } finally {
        if (before) await db.from("ai_limits").upsert(before);
        else await db.from("ai_limits").delete().eq("org_id", ORG_A);
      }
    } finally {
      await db.from("ai_usage").delete().eq("org_id", ORG_A).eq("model", model);
    }
  });

  test("comunicación ve el consumo sin poder editar; lectura no entra", async ({ page }) => {
    await login(page, USERS.comunicacion, "/configuracion/consumo");
    await expect(page.getByRole("main").getByText("Sólo un administrador puede cambiarlos.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Guardar límites" })).toHaveCount(0);
    await login(page, USERS.lectura, "/bandeja");
    await page.goto("/configuracion/consumo");
    await expect(page).not.toHaveURL(/\/configuracion\/consumo/);
  });
});

test.describe("autores verificados", () => {
  test("comunicación verifica un canal con evidencia y responsable, y lo revoca con motivo", async ({ page }) => {
    const db = admin();
    const channel = `UC${String(Date.now()).padStart(22, "0").slice(-22)}`;
    try {
      await login(page, USERS.comunicacion, "/configuracion/autores");
      const main = page.getByRole("main");
      const form = main.getByRole("form", { name: "Verificar cuenta" });
      await form.getByLabel("Plataforma").selectOption("youtube");
      await form.getByLabel("Cuenta").fill(channel);
      await form.getByLabel("Tipo").selectOption("media");
      await form.getByLabel("Nombre público").fill("Canal de prueba e2e");
      await form.getByLabel("Evidencia de verificación").fill("Canal oficial de una televisora ficticia (prueba).");
      await form.getByRole("button", { name: "Agregar al catálogo" }).click();
      await expect(toast(page, /Cuenta verificada/)).toBeVisible();

      const row = main.getByRole("table", { name: "Catálogo de autores verificados" }).getByRole("row").filter({ hasText: "Canal de prueba e2e" });
      await expect(row).toContainText(channel);
      await expect(row).toContainText("Medio");
      const { data: entry } = await db.from("verified_authors").select("verified_by, verified_by_name").eq("handle", channel).single();
      expect(entry!.verified_by).toBe("00000000-0000-4000-d000-000000000002");

      page.once("dialog", (d) => d.accept("Prueba: no es un medio."));
      await row.getByRole("button", { name: /Revocar verificación/ }).click();
      await expect(toast(page, /Verificación revocada/)).toBeVisible();
      await expect(row).toContainText("Prueba: no es un medio.");
    } finally {
      await db.from("verified_authors").delete().eq("handle", channel);
    }
  });

  test("las cuentas no verificadas se muestran sin identidad en la bandeja", async ({ page }) => {
    const db = admin();
    const { data: m } = await db
      .from("mentions")
      .select("id, authors!inner(kind)")
      .eq("org_id", ORG_A)
      .eq("authors.kind", "citizen")
      .order("published_at", { ascending: false })
      .limit(1)
      .single();
    test.skip(!m, "Sin menciones de cuentas no verificadas.");
    await login(page, USERS.comunicacion, `/bandeja?mention=${m!.id}&status=all`);
    const main = page.getByRole("main");
    await expect(main.getByText("Cuenta no verificada").first()).toBeVisible();
    await expect(main.getByText(/@nv_/)).toHaveCount(0);
  });
});
