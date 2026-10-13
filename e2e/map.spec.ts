import { expect, test, type Page } from "@playwright/test";
import { pointInGeometry, validateGeometry, type Geometry } from "../src/lib/map/geometry";
import { admin, login, toast, USERS } from "./helpers";

// Stage 8: layers of the map, case locations and access by role. Fictitious data.
const ORG = "00000000-0000-4000-a000-000000000001";
const CATEGORY = "Prueba e2e mapa";

const main = (page: Page) => page.getByRole("main");
const casesTable = (page: Page) => main(page).getByRole("table", { name: "Casos por colonia" });
const row = (page: Page, name: string) => casesTable(page).getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });

/**
 * A colonia of the catalog this environment has (local seed or preview), with
 * two points inside its polygon and one outside. A drawn polygon is preferred:
 * approximate zones accept any point.
 */
async function pickColonia() {
  const { data } = await admin().from("neighborhoods").select("id, name, geojson, shape_source").eq("org_id", ORG).order("name");
  const sorted = [...(data ?? [])].sort((a, b) => Number(a.shape_source === "osm_approx") - Number(b.shape_source === "osm_approx"));
  for (const n of sorted) {
    const check = validateGeometry(n.geojson);
    if (!check.ok) continue;
    const g: Geometry = check.geometry;
    const coords = (JSON.stringify(g.coordinates).match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const lngs = coords.filter((_, i) => i % 2 === 0);
    const lats = coords.filter((_, i) => i % 2 === 1);
    const [minLng, maxLng, minLat, maxLat] = [Math.min(...lngs), Math.max(...lngs), Math.min(...lats), Math.max(...lats)];
    const inside: [number, number][] = [];
    for (let i = 1; i < 20 && inside.length < 2; i++) {
      for (let j = 1; j < 20 && inside.length < 2; j++) {
        const lat = Number((minLat + ((maxLat - minLat) * i) / 20).toFixed(5));
        const lng = Number((minLng + ((maxLng - minLng) * j) / 20).toFixed(5));
        if (pointInGeometry(g, lng, lat) && !inside.some(([a, b]) => a === lat && b === lng)) inside.push([lat, lng]);
      }
    }
    if (inside.length < 2) continue;
    const outside: [number, number] = [Number((maxLat + 0.02).toFixed(5)), inside[0][1]];
    const total = (data ?? []).length;
    return { id: n.id, name: n.name, approx: n.shape_source === "osm_approx", inside, outside, total };
  }
  return null;
}

async function freeMentions(n: number) {
  const db = admin();
  const [{ data: mentions }, { data: tickets }, { data: linked }] = await Promise.all([
    db.from("mentions").select("id, triage").eq("org_id", ORG).eq("status", "classified").neq("triage", "discarded").order("published_at", { ascending: false }).limit(300),
    db.from("tickets").select("mention_id").eq("org_id", ORG),
    db.from("case_mentions").select("mention_id").eq("org_id", ORG),
  ]);
  const busy = new Set([...(tickets ?? []), ...(linked ?? [])].map((r) => r.mention_id));
  return (mentions ?? []).filter((m) => !busy.has(m.id)).slice(0, n);
}

test.describe("mapa de colonias", () => {
  test("lectura cambia la métrica, abre una colonia y llega a la bandeja filtrada", async ({ page }) => {
    // A worker that fails to load leaves the canvas up but draws no colonias.
    const mapErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /worker/i.test(m.text())) mapErrors.push(m.text());
    });
    const worker = page.waitForRequest(/maplibre-gl-worker[^/]*\.mjs/);
    await login(page, USERS.lectura, "/mapa?periodo=30d");
    expect((await worker).url()).toContain("/_next/static/");
    await expect(page.getByRole("heading", { name: "Mapa", level: 1 })).toBeVisible();
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();

    // The metric changes the URL without a server round trip.
    await page.getByRole("radio", { name: "Sentimiento neto" }).click();
    await expect(page).toHaveURL(/metrica=nss/);
    await expect(page.getByRole("heading", { name: /Ranking por sentimiento neto/ })).toBeVisible();

    // A colonia from the ranking opens its panel.
    await page.getByRole("radio", { name: "Menciones" }).click();
    const first = page.locator("ol li button").first();
    const name = (await first.locator("span.truncate").first().textContent())?.trim() ?? "";
    await first.click();
    await expect(page).toHaveURL(/colonia=/);
    const panel = page.getByRole("heading", { name, level: 2 });
    await expect(panel).toBeVisible();
    await expect(page.getByRole("heading", { name: "Turnos", level: 3 })).toBeVisible();

    await page.getByRole("link", { name: /Ver todas en la bandeja/ }).click();
    await expect(page).toHaveURL(/\/bandeja\?.*neighborhood=/);
    expect(mapErrors).toEqual([]);
  });

  test("la tabla equivale al mapa, se usa con teclado y las menciones sin colonia siguen a la vista", async ({ page }) => {
    // Without the street basemap (offline, service down) the colonias and the table remain.
    await page.route(/tiles\.openfreemap\.org/, (route) => route.abort());
    await login(page, USERS.comunicacion, "/mapa?periodo=30d");
    await expect(main(page).getByText(/Sin mapa de calles/)).toBeVisible();
    const table = main(page).getByRole("table", { name: "Menciones por colonia" });
    await expect(table).toBeVisible();
    // Header + every colonia of the catalog, zeros included (catalogs up to 200 list them all).
    const { count } = await admin().from("neighborhoods").select("id", { count: "exact", head: true }).eq("org_id", ORG);
    if ((count ?? 0) <= 200) await expect(table.getByRole("row")).toHaveCount((count ?? 0) + 1);
    await expect(main(page).getByRole("heading", { name: /Menciones sin colonia: \d+/ })).toBeVisible();

    // Keyboard: the first colonia of the table opens its detail.
    const link = table.getByRole("link").first();
    const name = (await link.textContent())?.trim() ?? "";
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/colonia=/);
    await expect(main(page).getByRole("heading", { name, level: 2 })).toBeVisible();
  });

  test("casos: conteos iguales a Casos, inferida sin punto, confirmar y corregir con historial", async ({ browser }) => {
    const mentions = await freeMentions(2);
    test.skip(mentions.length < 2, "La base no tiene menciones libres.");
    const colonia = await pickColonia();
    test.skip(!colonia, "El catálogo no tiene una colonia con polígono válido.");
    const { id: COLONIA, name: NAME, approx, inside, outside } = colonia!;
    const db = admin();
    const ids: string[] = [];
    for (const m of mentions) {
      const { data, error } = await db.rpc("create_case", {
        p_org_id: ORG,
        p_mention_ids: [m.id],
        p_title: "Prueba e2e: bache frente al mercado",
        p_category: CATEGORY,
        p_neighborhood_id: COLONIA,
        p_priority: "high",
      });
      expect(error).toBeNull();
      ids.push(data as string);
    }
    // The second one loses its colonia: it must stay visible as "sin ubicación".
    await db.from("cases").update({ neighborhood_id: null }).eq("id", ids[1]);
    const com = await browser.newPage();
    const obras = await browser.newPage();
    const lectura = await browser.newPage();
    try {
      const mapUrl = `/mapa?periodo=7d&capa=casos&tema=${encodeURIComponent(CATEGORY)}`;
      await login(com, USERS.comunicacion, mapUrl);
      await expect(casesTable(com)).toBeVisible();
      // The colonia: 1 case, inferred (counted in the colonia, no point).
      await expect(row(com, NAME).getByRole("cell")).toHaveText([NAME, "1", "0", "0", "1", approx ? "Zona aproximada" : "—"]);
      await expect(main(com).getByText("0 ubicaciones confirmadas con punto")).toBeVisible();
      await expect(main(com).getByRole("heading", { name: "Casos sin ubicación: 1" })).toBeVisible();
      await expect(main(com).getByRole("list", { name: "Casos sin ubicación" }).getByRole("listitem")).toHaveCount(1);

      // The same filters in /casos give the same counts.
      await row(com, NAME).getByRole("link", { name: NAME, exact: true }).click();
      await expect(com).toHaveURL(/colonia=/);
      await main(com).getByRole("link", { name: "Ver el caso" }).click();
      await expect(com).toHaveURL(/\/casos\?.*categoria=/);
      await expect(main(com).getByText("1 caso", { exact: true })).toBeVisible();
      await expect(main(com).getByText(/Categoría: Prueba e2e mapa/)).toBeVisible();
      await com.goto(mapUrl);
      await main(com).getByRole("link", { name: "Verlos en Casos con los mismos filtros" }).click();
      await expect(com).toHaveURL(/colonia=sin/);
      await expect(main(com).getByText("1 caso", { exact: true })).toBeVisible();

      // Confirm: a point outside the colonia is rejected; inside it is saved with history.
      await com.goto(`/casos/${ids[0]}`);
      await expect(main(com).getByText("Inferida", { exact: true }).first()).toBeVisible();
      await main(com).getByRole("button", { name: "Confirmar ubicación" }).click();
      let dialog = com.getByRole("dialog");
      if (!approx) {
        // Approximate zones accept any point: only a drawn polygon can reject one.
        await dialog.getByLabel("Latitud (opcional)").fill(String(outside[0]));
        await dialog.getByLabel("Longitud (opcional)").fill(String(outside[1]));
        await dialog.getByRole("button", { name: "Guardar" }).click();
        await expect(toast(com, `El punto no está dentro de la colonia ${NAME}.`)).toBeVisible();
      }
      await dialog.getByLabel("Latitud (opcional)").fill(String(inside[0][0]));
      await dialog.getByLabel("Longitud (opcional)").fill(String(inside[0][1]));
      await dialog.getByRole("button", { name: "Guardar" }).click();
      await expect(toast(com, "Ubicación confirmada.")).toBeVisible();
      await expect(main(com).getByText("Confirmada", { exact: true }).first()).toBeVisible();

      // A correction needs a reason.
      await main(com).getByRole("button", { name: "Corregir ubicación" }).click();
      dialog = com.getByRole("dialog");
      await dialog.getByLabel("Latitud (opcional)").fill(String(inside[1][0]));
      await dialog.getByLabel("Longitud (opcional)").fill(String(inside[1][1]));
      await dialog.getByLabel("Motivo").fill("Verificado en recorrido");
      await dialog.getByRole("button", { name: "Guardar" }).click();
      await expect(toast(com, "Ubicación corregida.")).toBeVisible();
      await main(com).getByText(/Historial de ubicación/).click();
      const history = main(com).getByRole("list", { name: "Historial de ubicación" });
      await expect(history.getByRole("listitem")).toHaveCount(3);
      await expect(history.getByRole("listitem").first()).toContainText("«Verificado en recorrido»");

      // Now one point on the map (rounded), still 1 case in the colonia.
      await com.goto(mapUrl);
      await expect(main(com).getByText("1 ubicaciones confirmadas con punto")).toBeVisible();
      await expect(row(com, NAME).getByRole("cell").nth(3)).toHaveText("1");

      // Lectura reads the location but cannot change it.
      await login(lectura, USERS.lectura, `/casos/${ids[0]}`);
      await expect(main(lectura).getByText("Confirmada", { exact: true }).first()).toBeVisible();
      await expect(main(lectura).getByRole("button", { name: /ubicación/ })).toHaveCount(0);

      // A department only has its cases layer: unassigned cases are not in its scope.
      await login(obras, USERS.obras, `/mapa?periodo=7d&capa=conversacion&tema=${encodeURIComponent(CATEGORY)}`);
      await expect(main(obras).getByText(/Sólo los casos turnados a/)).toBeVisible();
      await expect(main(obras).getByRole("radiogroup", { name: "Capa" })).toHaveCount(0);
      await expect(main(obras).getByRole("table", { name: "Menciones por colonia" })).toHaveCount(0);
      await expect(row(obras, NAME).getByRole("cell").nth(1)).toHaveText("0");
      await expect(main(obras).getByRole("heading", { name: "Casos sin ubicación: 0" })).toBeVisible();
    } finally {
      await Promise.all([com.close(), obras.close(), lectura.close()]);
      await db.from("cases").delete().in("id", ids);
      for (const m of mentions) await db.from("mentions").update({ triage: m.triage as "new" }).eq("id", m.id);
    }
  });
});
