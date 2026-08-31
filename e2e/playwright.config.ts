import { defineConfig, devices } from "@playwright/test";

import { FRONTEND_URL, PROCESSING_TIMEOUT_MS } from "./src/config";

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",

  // БД общая: изоляция держится на уникальных title, поэтому параллелить можно.
  fullyParallel: true,
  workers: isCI ? 2 : undefined,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,

  // Ожидание асинхронной обработки — самая долгая часть теста.
  timeout: PROCESSING_TIMEOUT_MS + 30_000,
  expect: { timeout: 10_000 },

  reporter: isCI
    ? [["list"], ["html", { open: "never" }], ["github"]]
    : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: FRONTEND_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Расширить до firefox/webkit можно, добавив аналогичные проекты.
  ],
});
