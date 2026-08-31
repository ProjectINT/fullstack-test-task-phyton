import { defineConfig, devices } from "@playwright/test";

import { FRONTEND_URL, PROCESSING_TIMEOUT_MS } from "./src/config";

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",

  // БД общая, но каждый тест работает со своими записями (уникальный title) и
  // не смотрит на глобальные счётчики — empty-state и счётчики проверяются на
  // моках роутов. Поэтому полная параллельность безопасна: 3x-прогон
  // (`npm run test:repeat`) зелёный и на 16 воркерах, и на CI-овских двух.
  // Если появится тест, зависящий от состояния всей БД, — ему нужен
  // `test.describe.serial` или отдельный проект с `workers: 1`.
  fullyParallel: true,
  // На раннере GitHub Actions рядом крутится весь стек (Postgres, Celery, Next),
  // поэтому воркеров меньше, чем ядер.
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
