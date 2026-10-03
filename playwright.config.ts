import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E against the dev stack (web + worker, mock provider, dev tools enabled).
 * Prerequisites: `docker compose up -d && pnpm db:migrate && pnpm db:seed`.
 * Run: `pnpm test:e2e` (starts `pnpm dev` unless it is already running).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
