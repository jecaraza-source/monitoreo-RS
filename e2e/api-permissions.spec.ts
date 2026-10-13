import { expect, test } from "@playwright/test";
import { solidPng } from "./fixtures-png";
import { admin, anonApi, apiAs, canCallApiDirectly, ORG_B, USERS, USERS_B } from "./helpers";

// Stage 12: permissions do not depend on the menu. Each role calls PostgREST,
// RPCs and Storage directly with its own session (the publishable key and the
// JWT the browser holds) and gets exactly what RLS allows. Fictitious data.
const ORG_A = "00000000-0000-4000-a000-000000000001";
const AGUA = "00000000-0000-4000-b000-000000000002";

test.describe("permisos por API, SQL y Storage (sin menú)", () => {
  test.skip(!canCallApiDirectly(), "Necesita la llave publicable del proyecto (E2E_SUPABASE_PUBLISHABLE_KEY).");
  test.setTimeout(120_000);

  let caseId = "";
  let mentionId = "";
  let evidencePath = "";

  test.beforeAll(async () => {
    const db = admin();
    // A case of Agua Potable with an evidence file, created by the server.
    const [{ data: mentions }, { data: tickets }, { data: linked }] = await Promise.all([
      db.from("mentions").select("id").eq("org_id", ORG_A).eq("status", "classified").order("published_at").limit(300),
      db.from("tickets").select("mention_id").eq("org_id", ORG_A),
      db.from("case_mentions").select("mention_id").eq("org_id", ORG_A),
    ]);
    const busy = new Set([...(tickets ?? []), ...(linked ?? [])].map((r) => r.mention_id));
    mentionId = (mentions ?? []).find((m) => !busy.has(m.id))!.id;
    const created = await db.rpc("create_case", { p_org_id: ORG_A, p_mention_ids: [mentionId], p_title: "Prueba de permisos (e2e)", p_priority: "medium" });
    expect(created.error).toBeNull();
    caseId = created.data as string;
    const com = await apiAs(USERS.comunicacion);
    const assigned = await com.rpc("assign_case", {
      p_case_id: caseId,
      p_department_id: AGUA,
      p_due_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      p_accept_due_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(assigned.error).toBeNull();
    evidencePath = `${ORG_A}/${caseId}/${crypto.randomUUID()}.png`;
    const up = await db.storage.from("case-evidence").upload(evidencePath, solidPng(16, 16, [10, 20, 30]), { contentType: "image/png" });
    expect(up.error).toBeNull();
  });

  test.afterAll(async () => {
    const db = admin();
    if (evidencePath) await db.storage.from("case-evidence").remove([evidencePath]);
    if (caseId) {
      await db.from("tickets").delete().eq("case_id", caseId);
      await db.from("cases").delete().eq("id", caseId);
    }
  });

  test("sin sesión no se lee ni se escribe nada", async () => {
    const anon = anonApi();
    const mentions = await anon.from("mentions").select("id").limit(5);
    expect(mentions.data ?? []).toHaveLength(0);
    const insert = await anon.from("cases").insert({ org_id: ORG_A, number: 999999, title: "x" } as never);
    expect(insert.error).not.toBeNull();
    const rpc = await anon.rpc("kpi_snapshot", { p_org_id: ORG_A, p_from: new Date(0).toISOString(), p_to: new Date().toISOString(), p_prev_from: new Date(0).toISOString(), p_prev_to: new Date(0).toISOString(), p_bucket: "day" });
    expect(rpc.error).not.toBeNull();
    const file = await anon.storage.from("case-evidence").download(evidencePath);
    expect(file.error).not.toBeNull();
  });

  test("Consulta lee pero no modifica, ni por API", async () => {
    const lectura = await apiAs(USERS.lectura);
    expect((await lectura.from("cases").select("id").eq("id", caseId)).data).toHaveLength(1);
    const update = await lectura.from("cases").update({ title: "cambiado" }).eq("id", caseId).select("id");
    expect(update.error !== null || (update.data ?? []).length === 0).toBe(true);
    expect((await lectura.rpc("transition_case", { p_case_id: caseId, p_to: "discarded", p_reason: "prueba de permisos" })).error).not.toBeNull();
    expect((await lectura.rpc("log_export", { p_org_id: ORG_A, p_kind: "cases", p_filters: {}, p_rows: 1 })).error?.code).toBe("42501");
    expect((await lectura.from("ai_calls").select("id").limit(1)).data ?? []).toHaveLength(0);
    expect((await admin().from("cases").select("title").eq("id", caseId).single()).data!.title).toBe("Prueba de permisos (e2e)");
  });

  test("una dependencia sólo ve y toca lo suyo, también en Storage", async () => {
    // Agua (the assigned department) sees its case and uploads evidence through the Storage policy.
    const agua = await apiAs(USERS.agua);
    expect((await agua.from("cases").select("id").eq("id", caseId)).data).toHaveLength(1);
    const own = `${ORG_A}/${caseId}/${crypto.randomUUID()}.png`;
    const uploaded = await agua.storage.from("case-evidence").upload(own, solidPng(12, 12, [200, 10, 10]), { contentType: "image/png" });
    expect(uploaded.error).toBeNull();
    expect((await agua.storage.from("case-evidence").download(own)).error).toBeNull();
    // Obras cannot read Agua's upload either.
    const obrasPeek = await apiAs(USERS.obras);
    expect((await obrasPeek.storage.from("case-evidence").download(own)).error).not.toBeNull();
    await admin().storage.from("case-evidence").remove([own]);

    const obras = await apiAs(USERS.obras);
    // A case of Agua does not exist for Obras.
    expect((await obras.from("cases").select("id").eq("id", caseId)).data).toHaveLength(0);
    expect((await obras.rpc("transition_case", { p_case_id: caseId, p_to: "accepted", p_reason: null as unknown as string })).error).not.toBeNull();
    expect((await obras.storage.from("case-evidence").download(evidencePath)).error).not.toBeNull();
    const intruder = await obras.storage
      .from("case-evidence")
      .upload(`${ORG_A}/${caseId}/${crypto.randomUUID()}.png`, solidPng(8, 8, [0, 0, 0]), { contentType: "image/png" });
    expect(intruder.error).not.toBeNull();
    expect((await obras.rpc("reapply_sla", { p_org_id: ORG_A, p_case_ids: [caseId], p_reason: "intento sin permiso" })).error?.code).toBe("42501");
  });

  test("otro municipio no ve nada del primero, aunque pida por id", async () => {
    test.skip(!(await admin().from("organizations").select("id").eq("id", ORG_B).maybeSingle()).data, "Sin segundo municipio en esta base.");
    const b = await apiAs(USERS_B.admin);
    expect((await b.from("cases").select("id").eq("id", caseId)).data).toHaveLength(0);
    expect((await b.from("mentions").select("id").eq("id", mentionId)).data).toHaveLength(0);
    expect((await b.from("mentions").select("id").eq("org_id", ORG_A).limit(1)).data).toHaveLength(0);
    expect((await b.storage.from("case-evidence").download(evidencePath)).error).not.toBeNull();
    const rpc = await b.rpc("kpi_snapshot", { p_org_id: ORG_A, p_from: new Date(Date.now() - 86_400_000).toISOString(), p_to: new Date().toISOString(), p_prev_from: new Date(Date.now() - 2 * 86_400_000).toISOString(), p_prev_to: new Date(Date.now() - 86_400_000).toISOString(), p_bucket: "day" });
    expect(rpc.error).not.toBeNull();
    const write = await b.from("case_categories").insert({ org_id: ORG_A, name: "Intrusa" });
    expect(write.error).not.toBeNull();
    // Its own municipality works.
    expect((await b.from("organizations").select("id").eq("id", ORG_B)).data).toHaveLength(1);
  });

  test("Comunicación no hace lo que es de Administración, aunque llame directo", async () => {
    const com = await apiAs(USERS.comunicacion);
    expect((await com.rpc("reapply_sla", { p_org_id: ORG_A, p_case_ids: [caseId], p_reason: "intento sin permiso" })).error?.code).toBe("42501");
    const retention = await com.from("retention_policies").insert({ org_id: ORG_A, mention_months: null, updated_by: "00000000-0000-4000-d000-000000000002" });
    expect(retention.error).not.toBeNull();
    const limits = await com.from("ai_limits").update({ user_daily_requests: 1 }).eq("org_id", ORG_A).select("org_id");
    expect(limits.error !== null || (limits.data ?? []).length === 0).toBe(true);
    const audit = await com.from("audit_log").select("id").limit(1);
    expect(audit.data ?? []).toHaveLength(0);
  });
});
