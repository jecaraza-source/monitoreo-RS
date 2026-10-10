import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (e2e/*.spec.ts). By default against the local app with the
 * local Supabase stack and the seed; in CI also against a Vercel preview:
 *   E2E_BASE_URL                       app URL (default http://localhost:3000)
 *   E2E_SUPABASE_URL / E2E_SUPABASE_SERVICE_ROLE_KEY
 *                                      the Supabase project of that app (to mint login links)
 *   VERCEL_AUTOMATION_BYPASS_SECRET    for previews behind Vercel Deployment Protection
 *   PW_CHROMIUM_PATH                   use an already installed Chromium
 */
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
    trace: "retain-on-failure",
    extraHTTPHeaders: bypass ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" } : undefined,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
        launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
      },
    },
  ],
});
