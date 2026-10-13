import { expect, test, type APIRequestContext } from "@playwright/test";
import { admin, login, toast, USERS } from "./helpers";

// Stage 7 with mocks only (Anthropic, Resend and WhatsApp simulators): SLA
// configuration, report jobs under concurrent crons and email failures,
// escalation once per step, quiet hours that never hold back emergencies.
// Fictitious data; everything changed is restored.
const ORG = "00000000-0000-4000-a000-000000000001";
const OBRAS = "00000000-0000-4000-b000-000000000001";
const OBRAS_USER = "00000000-0000-4000-d000-000000000003";
const MOCK = process.env.E2E_MOCK_URL ?? "http://127.0.0.1:4010";
const LOCAL_ONLY = !process.env.CRON_SECRET || Boolean(process.env.E2E_BASE_URL);
const cron = (request: APIRequestContext, path: string) =>
  request.get(path, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, timeout: 120_000 });

type MockEmail = { to: string[]; subject: string; idempotencyKey: string | null; attachments: { filename: string; pdf: string }[] };
const emails = async (request: APIRequestContext) => (await (await request.get(`${MOCK}/emails`)).json()) as MockEmail[];

async function freeMentions(n: number) {
  const db = admin();
  const [{ data: mentions }, { data: tickets }, { data: linked }] = await Promise.all([
    db.from("mentions").select("id, triage").eq("org_id", ORG).eq("status", "classified").order("published_at").limit(300),
    db.from("tickets").select("mention_id").eq("org_id", ORG),
    db.from("case_mentions").select("mention_id").eq("org_id", ORG),
  ]);
  const busy = new Set([...(tickets ?? []), ...(linked ?? [])].map((r) => r.mention_id));
  return (mentions ?? []).filter((m) => !busy.has(m.id)).slice(0, n);
}

test.describe("SLA, escalamiento y envíos", () => {
  test("admin configura horas hábiles y un día inhábil; la versión es referencia hasta aprobarla y la asignación la usa", async ({ browser }) => {
    const db = admin();
    const [{ data: cal }, { data: holidays }, { data: targets }, { data: versions }] = await Promise.all([
      db.from("sla_calendars").select("*").eq("org_id", ORG).single(),
      db.from("sla_holidays").select("*").eq("org_id", ORG),
      db.from("sla_targets").select("org_id, category, priority, accept_hours, attention_hours").eq("org_id", ORG),
      db.from("sla_versions").select("version").eq("org_id", ORG).order("version", { ascending: false }).limit(1),
    ]);
    const lastVersion = versions?.[0]?.version ?? 0;
    const [mention] = await freeMentions(1);
    test.skip(!mention, "La base no tiene menciones libres.");
    const { data: caseId } = await db.rpc("create_case", { p_org_id: ORG, p_mention_ids: [mention.id], p_title: "Prueba e2e: SLA hábil", p_priority: "high" });
    const page = await browser.newPage();
    const com = await browser.newPage();
    try {
      await login(page, USERS.admin, "/configuracion/sla");
      const form = page.getByRole("form", { name: "Configuración del SLA" });
      await form.getByRole("radio", { name: "Horas hábiles" }).check();
      await form.getByLabel("Fecha inhábil").fill("2026-12-25");
      await form.getByLabel("Nombre del día inhábil").fill("Navidad");
      await form.getByRole("button", { name: "Agregar" }).click();
      await expect(form.getByRole("list", { name: "Días inhábiles" }).getByText("Navidad")).toBeVisible();
      await form.getByRole("button", { name: "Guardar como nueva versión" }).click();
      await expect(toast(page, `Guardado como versión ${lastVersion + 1}`)).toBeVisible();
      await expect(page.getByRole("main").getByText("valores de referencia, sin acuerdo aprobado")).toBeVisible();

      await page.getByLabel("Acuerdo que respalda estos plazos").fill("Acta ficticia de cabildo 12/2026");
      await page.getByRole("button", { name: `Aprobar versión ${lastVersion + 1}` }).click();
      await expect(toast(page, "Versión aprobada como acuerdo operativo.")).toBeVisible();

      // The assignment of a case proposes the SLA's deadlines and says which version.
      await login(com, USERS.comunicacion, `/casos/${caseId}`);
      await com.getByRole("main").getByRole("button", { name: "Asignar" }).click();
      const dialog = com.getByRole("dialog");
      await expect(dialog.getByText(`Plazos del SLA versión ${lastVersion + 1} (horas hábiles), aprobado.`)).toBeVisible();
      await dialog.getByRole("combobox", { name: "Dependencia responsable" }).click();
      await com.getByRole("option", { name: "Obras Públicas" }).click();
      await dialog.getByRole("button", { name: "Asignar" }).click();
      await expect(toast(com, "Caso asignado.")).toBeVisible();
      const { data: assigned } = await db.from("cases").select("sla_terms, sla_version_id").eq("id", caseId as string).single();
      expect((assigned!.sla_terms as { overridden: boolean; mode: string }).overridden).toBe(false);
      expect((assigned!.sla_terms as { mode: string }).mode).toBe("business");
      await expect(com.getByRole("main").getByText(`Versión ${lastVersion + 1} · acuerdo aprobado`)).toBeVisible();
    } finally {
      await db.from("tickets").delete().eq("case_id", caseId as string);
      await db.from("cases").delete().eq("id", caseId as string);
      await db.from("mentions").update({ triage: mention.triage as "new" }).eq("id", mention.id);
      await db.from("sla_calendars").update({ mode: cal!.mode, workdays: cal!.workdays, day_start: cal!.day_start, day_end: cal!.day_end }).eq("org_id", ORG);
      await db.from("sla_holidays").delete().eq("org_id", ORG);
      if (holidays?.length) await db.from("sla_holidays").insert(holidays);
      await db.from("sla_targets").delete().eq("org_id", ORG);
      await db.from("sla_targets").insert(targets!);
      await db.from("sla_versions").delete().eq("org_id", ORG).gt("version", lastVersion);
      await page.close();
      await com.close();
    }
  });

  test("dos crons de reportes a la vez crean un solo reporte; el correo caído se reintenta y llega una vez", async ({ request, browser }) => {
    test.skip(LOCAL_ONLY, "Sólo con el simulador local y CRON_SECRET.");
    const db = admin();
    const { data: previous } = await db.from("report_schedules").select("*").eq("org_id", ORG).eq("period", "daily").maybeSingle();
    const { data: oldJobs } = await db.from("report_jobs").select("id").eq("org_id", ORG).eq("kind", "daily");
    const oldJobIds = new Set((oldJobs ?? []).map((j) => j.id));
    await db.from("report_schedules").upsert(
      { org_id: ORG, period: "daily", recipients: ["cabildo@monitoreo.test"], auto_approve: true, is_active: true },
      { onConflict: "org_id,period" },
    );
    // Today's daily job must be new for this test.
    const { data: existing } = await db.from("report_jobs").select("id, period_start").eq("org_id", ORG).eq("kind", "daily").order("period_start", { ascending: false }).limit(1);
    const todaysOld = existing?.[0];
    if (todaysOld) {
      await db.from("reports").update({ job_id: null }).eq("job_id", todaysOld.id);
      await db.from("report_jobs").delete().eq("id", todaysOld.id);
    }
    const page = await browser.newPage();
    let jobId: string | undefined;
    try {
      // The email provider fails once.
      await request.post(`${MOCK}/__mock/faults`, { data: { resend: { status: 500, times: 1 } } });
      const [a, b] = await Promise.all([cron(request, "/api/cron/reports"), cron(request, "/api/cron/reports")]);
      expect(a.status()).toBe(200);
      expect(b.status()).toBe(200);

      const { data: jobs } = await db.from("report_jobs").select("id, stage, report_id, attempts").eq("org_id", ORG).eq("kind", "daily");
      const fresh = (jobs ?? []).filter((j) => !oldJobIds.has(j.id) || j.id === todaysOld?.id);
      expect(fresh).toHaveLength(1);
      jobId = fresh[0].id;
      const { count } = await db.from("reports").select("id", { count: "exact", head: true }).eq("job_id", jobId);
      expect(count).toBe(1);
      expect(fresh[0].stage).toBe("sending");

      // The email is waiting for its retry (backoff): let the time pass, then the notify cron sends it.
      const reportId = fresh[0].report_id!;
      const { data: queued } = await db.from("outbox").select("id, status, attempts, last_error").eq("report_id", reportId);
      expect(queued).toHaveLength(1);
      expect(queued![0]).toMatchObject({ status: "pending", attempts: 1 });
      await db.from("outbox").update({ next_attempt_at: new Date().toISOString() }).eq("id", queued![0].id);
      await cron(request, "/api/cron/notify");
      await cron(request, "/api/cron/notify");

      const { data: job } = await db.from("report_jobs").select("stage").eq("id", jobId).single();
      expect(job!.stage).toBe("done");
      const { data: report } = await db.from("reports").select("status").eq("id", reportId).single();
      expect(report!.status).toBe("sent");
      const delivered = (await emails(request)).filter((e) => e.idempotencyKey?.startsWith(`report:${reportId}:`));
      expect(delivered).toHaveLength(1);
      expect(delivered[0].attachments[0].pdf).toBe("%PDF-");

      // The admin sees it in Envíos with its provider id and the job done.
      await login(page, USERS.admin, "/configuracion/envios");
      const table = page.getByRole("table", { name: "Envíos recientes" });
      await expect(table.getByRole("row").filter({ hasText: "Reporte" }).first()).toContainText("Enviado");
      await expect(table.getByRole("row").filter({ hasText: "Reporte" }).first()).toContainText("2/6");
    } finally {
      await request.delete(`${MOCK}/__mock/faults`);
      if (jobId) {
        const { data: r } = await db.from("reports").select("id").eq("job_id", jobId);
        const ids = (r ?? []).map((x) => x.id);
        if (ids.length) {
          await db.from("outbox").delete().in("report_id", ids);
          await db.storage.from("reports").remove(ids.map((id) => `${ORG}/${id}.pdf`));
          await db.from("reports").delete().in("id", ids);
        }
        await db.from("report_jobs").delete().eq("id", jobId);
      }
      if (previous) await db.from("report_schedules").update(previous).eq("id", previous.id);
      else await db.from("report_schedules").delete().eq("org_id", ORG).eq("period", "daily");
      await page.close();
    }
  });

  test("un caso vencido escala al enlace una sola vez; en horario de silencio espera, pero la emergencia sale", async ({ request }) => {
    test.skip(LOCAL_ONLY, "Sólo con el simulador local y CRON_SECRET.");
    const db = admin();
    const mentions = await freeMentions(2);
    test.skip(mentions.length < 2, "La base no tiene menciones libres.");
    const [{ data: dept }, { data: settings }] = await Promise.all([
      db.from("departments").select("responsible_user_id").eq("id", OBRAS).single(),
      db.from("notification_settings").select("quiet_start, quiet_end").eq("org_id", ORG).single(),
    ]);
    const ids: string[] = [];
    try {
      await db.from("departments").update({ responsible_user_id: OBRAS_USER }).eq("id", OBRAS);
      // Quiet hours right now (Mexico City).
      const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Mexico_City" }).format(new Date()));
      await db.from("notification_settings").update({ quiet_start: hour, quiet_end: (hour + 2) % 24 }).eq("org_id", ORG);

      for (const [i, priority] of (["medium", "critical"] as const).entries()) {
        const { data: id } = await db.rpc("create_case", {
          p_org_id: ORG,
          p_mention_ids: [mentions[i].id],
          p_title: `Prueba e2e: ${priority === "critical" ? "derrumbe" : "bache"} sin aceptar`,
          p_priority: priority,
        });
        ids.push(id as string);
        // Assigned to Obras four hours ago; the acceptance deadline passed 30 minutes ago.
        await db
          .from("cases")
          .update({
            status: "assigned",
            department_id: OBRAS,
            assigned_at: new Date(Date.now() - 4 * 3_600_000).toISOString(),
            accept_due_at: new Date(Date.now() - 30 * 60_000).toISOString(),
            due_at: new Date(Date.now() + 48 * 3_600_000).toISOString(),
          })
          .eq("id", id as string);
      }
      const { data: folios } = await db.from("cases").select("id, folio").in("id", ids);
      const folioOf = new Map((folios ?? []).map((c) => [c.id, c.folio!]));

      await Promise.all([cron(request, "/api/cron/notify"), cron(request, "/api/cron/notify")]);
      await cron(request, "/api/cron/notify");

      const { data: events } = await db.from("notification_events").select("case_id, kind, level, result, reason, deadline").in("case_id", ids);
      expect(events).toHaveLength(2);
      for (const e of events!) {
        expect(e).toMatchObject({ level: "link", result: "queued" });
        expect(e.reason).toContain(folioOf.get(e.case_id!)!);
      }
      expect(events!.find((e) => e.case_id === ids[1])!.kind).toBe("emergency");

      const sent = (await emails(request)).filter((m) => ids.some((id) => m.subject.includes(folioOf.get(id)!)));
      expect(sent.map((m) => m.subject.split(" ")[0])).toEqual(["[Emergencia]"]);
      expect(sent[0].to).toEqual(["obras@monitoreo.test"]);
      const { data: waiting } = await db.from("outbox").select("status, deferred_reason, urgency").eq("kind", "escalation").eq("recipient_user_id", OBRAS_USER).in("event_id",
        (await db.from("notification_events").select("id").eq("case_id", ids[0])).data!.map((e) => e.id));
      expect(waiting).toEqual([{ status: "pending", deferred_reason: "quiet_hours", urgency: "normal" }]);
    } finally {
      await db.from("outbox").delete().in("event_id", (await db.from("notification_events").select("id").in("case_id", ids)).data?.map((e) => e.id) ?? []);
      await db.from("tickets").delete().in("case_id", ids);
      if (ids.length) await db.from("cases").delete().in("id", ids);
      for (const m of mentions) await db.from("mentions").update({ triage: m.triage as "new" }).eq("id", m.id);
      await db.from("departments").update({ responsible_user_id: dept?.responsible_user_id ?? null }).eq("id", OBRAS);
      if (settings) await db.from("notification_settings").update(settings).eq("org_id", ORG);
    }
  });

  test("cada persona elige sus canales y su horario de silencio", async ({ page }) => {
    const db = admin();
    try {
      await login(page, USERS.obras, "/preferencias");
      const form = page.getByRole("form", { name: "Mis avisos" });
      await form.getByRole("checkbox", { name: /WhatsApp/ }).uncheck();
      await form.getByRole("checkbox", { name: /Usar mi propio horario/ }).check();
      await form.getByLabel("Desde (hora)").fill("21");
      await form.getByLabel("Hasta (hora)").fill("8");
      await form.getByRole("button", { name: "Guardar" }).click();
      await expect(toast(page, "Preferencias guardadas.")).toBeVisible();
      const { data } = await db.from("notification_preferences").select("email, whatsapp, quiet_start, quiet_end").eq("user_id", OBRAS_USER).single();
      expect(data).toEqual({ email: true, whatsapp: false, quiet_start: 21, quiet_end: 8 });
    } finally {
      await db.from("notification_preferences").delete().eq("user_id", OBRAS_USER);
    }
  });
});
