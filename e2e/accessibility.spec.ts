import { expect, test, type Page } from "@playwright/test";
import { login, USERS } from "./helpers";

// Stage 12: mobile navigation, keyboard, contrast (WCAG AA, computed in the
// browser) and error states. Contrast is measured on the rendered text of the
// main pages in both themes; colors in oklch/color-mix are resolved through a
// canvas, the same pixels the person sees.

type Failure = { text: string; ratio: number; need: number; fg: string; bg: string };

/** Text whose contrast against its painted background is under AA (4.5:1, or 3:1 for large text). */
async function contrastFailures(page: Page): Promise<Failure[]> {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const rgba = (color: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (top: number[], bottom: number[]) => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3]));
    const background = (el: Element | null): number[] => {
      const layers: number[][] = [];
      for (let node = el; node; node = node.parentElement) {
        const c = rgba(getComputedStyle(node).backgroundColor);
        if (c[3] > 0) layers.push(c);
        if (c[3] >= 1) break;
      }
      let base = [...rgba(getComputedStyle(document.body).backgroundColor).slice(0, 3)];
      for (const layer of layers.reverse()) base = over(layer, base);
      return base;
    };
    const lum = (c: number[]) => {
      const [r, g, b] = c.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const out: Failure[] = [];
    const walker = document.createTreeWalker(document.querySelector("main") ?? document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || !n.textContent?.trim()) continue;
      seen.add(el);
      if (el.closest("[aria-hidden=true], .sr-only, [disabled], [aria-disabled=true], .maplibregl-map, svg")) continue;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (style.visibility === "hidden" || rect.width === 0 || rect.height === 0 || Number(style.opacity) < 0.1) continue;
      const fg = rgba(style.color);
      const bg = background(el);
      const color = over(fg, bg);
      const [l1, l2] = [lum(color), lum(bg)].sort((a, b) => b - a);
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      const need = large ? 3 : 4.5;
      if (ratio < need - 0.01) out.push({ text: n.textContent.trim().slice(0, 60), ratio: Math.round(ratio * 100) / 100, need, fg: style.color, bg: `rgb(${bg.map(Math.round).join(",")})` });
    }
    return out;
  });
}

const PAGES = ["/dashboard", "/bandeja", "/casos", "/mapa", "/reportes", "/ayuda", "/salud"];

test.describe("accesibilidad", () => {
  test.setTimeout(180_000);

  for (const theme of ["dark", "light"] as const) {
    test(`contraste AA del texto en las páginas principales (tema ${theme === "dark" ? "oscuro" : "claro"})`, async ({ page }) => {
      await page.addInitScript((t) => window.localStorage.setItem("theme", t), theme);
      await page.goto("/login");
      await page.waitForLoadState("networkidle");
      const all: (Failure & { page: string })[] = (await contrastFailures(page)).map((f) => ({ ...f, page: "/login" }));
      await login(page, USERS.comunicacion, "/dashboard");
      for (const path of PAGES) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await expect(page.locator("html")).toHaveClass(new RegExp(theme));
        all.push(...(await contrastFailures(page)).map((f) => ({ ...f, page: path })));
      }
      if (all.length) console.log(JSON.stringify(all, null, 1));
      expect(all, "textos bajo AA").toEqual([]);
    });
  }

  test("móvil: el menú se abre, navega y ninguna página se desborda a lo ancho", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    try {
      for (const [user, paths] of [
        [USERS.comunicacion, ["/dashboard", "/bandeja", "/casos", "/reportes", "/mapa", "/ayuda"]],
        [USERS.obras, ["/bandeja", "/casos", "/ayuda"]],
      ] as const) {
        await context.clearCookies();
        await login(page, user, paths[0]);
        for (const path of paths) {
          await page.goto(path);
          await page.waitForLoadState("networkidle");
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(overflow, `${path} se desborda ${overflow}px`).toBeLessThanOrEqual(1);
        }
        await page.getByRole("button", { name: "Mostrar u ocultar menú" }).first().click();
        const menu = page.getByRole("dialog");
        await expect(menu).toBeVisible();
        await menu.getByRole("link", { name: "Ayuda" }).click();
        await expect(page).toHaveURL(/\/ayuda/);
        await expect(page.getByRole("dialog")).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  });

  test("teclado: saltar al contenido, foco visible y formulario de acceso sin ratón", async ({ page }) => {
    // Login only with the keyboard (an address with no account: no email is sent).
    await page.goto("/login");
    for (let i = 0; i < 10 && (await page.evaluate(() => document.activeElement?.id)) !== "email"; i++) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("email");
    await page.keyboard.type("nadie-registrado@ejemplo.test");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Revisa tu correo")).toBeVisible();

    await login(page, USERS.comunicacion, "/casos");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Saltar al contenido" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("#contenido")).toBeFocused();

    // Every stop of the next 25 shows where the focus is.
    const invisible: string[] = [];
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        const ring = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== "none");
        return { ring, name: `${el.tagName.toLowerCase()} «${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}»` };
      });
      if (info && !info.ring) invisible.push(info.name);
    }
    expect(invisible, "elementos sin indicador de foco").toEqual([]);
  });

  test("estados de error: correo inválido, enlace vencido, recurso inexistente y exportación inválida", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#email", "esto-no-es-correo");
    await page.getByRole("button", { name: /enlace/i }).click();
    await expect(page.locator("#email")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#email-error")).toBeVisible();

    await page.goto("/auth/confirm?token_hash=pkce_vencido&type=magiclink");
    await expect(page.getByText("El enlace no es válido o ya expiró. Pide uno nuevo.")).toBeVisible();

    await login(page, USERS.comunicacion, "/casos/00000000-0000-4000-8000-00000000dead");
    await expect(page.getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();
    await page.goto("/ruta-que-no-existe");
    await expect(page.getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();

    const bad = await page.request.get("/api/exportar?tipo=casos&desde=2020-01-01&hasta=2026-01-01");
    expect(bad.status()).toBe(400);
    expect(await bad.text()).not.toMatch(/stack|at \w+ \(/i);
  });
});
