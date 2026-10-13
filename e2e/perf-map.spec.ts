import { test } from "@playwright/test";
import { login, USERS } from "./helpers";

// Load of the map with a representative dataset (stage 8). Off by default:
// load supabase/perf/map_scale.sql locally first, then run with PERF_MAP=1.
// Prints the server time and size of each page and the time until it is visible.
for (const [name, url] of [
  ["mapa casos", "/mapa?periodo=30d&capa=casos"],
  ["mapa conversación", "/mapa?periodo=30d"],
  ["lista de casos", "/casos?estado=all"],
] as const) {
  test(`carga: ${name}`, async ({ page }) => {
    test.skip(!process.env.PERF_MAP, "Medición manual: PERF_MAP=1 con supabase/perf/map_scale.sql cargado.");
    test.setTimeout(120_000);
    await login(page, USERS.comunicacion, "/preferencias");
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      const res = await page.request.get(url);
      const server = Date.now() - t0;
      const t1 = Date.now();
      await page.goto(url, { waitUntil: "load" });
      if (url.startsWith("/mapa")) await page.locator(".maplibregl-canvas").waitFor();
      else await page.getByRole("main").getByText(/\d casos/).first().waitFor();
      console.log(`${name} #${i + 1}: servidor ${server} ms (${Math.round((await res.body()).length / 1024)} kB), visible ${Date.now() - t1} ms`);
    }
  });
}
