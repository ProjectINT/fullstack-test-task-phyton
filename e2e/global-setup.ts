import { request } from "@playwright/test";

import { API_URL, APP_URL, STACK_READY_TIMEOUT_MS } from "./src/config";
import { ensureTestFiles } from "./src/test-files";

type Check = { name: string; url: string; hint: string };

const CHECKS: Check[] = [
  {
    name: "backend",
    url: `${API_URL}/files?limit=1`,
    hint: "docker compose -f docker-compose.dev.yml up -d backend backend-db backend-redis backend-worker && docker exec -it backend alembic upgrade head",
  },
  {
    name: "frontend",
    url: APP_URL,
    hint: "docker compose -f docker-compose.dev.yml up -d frontend (или `npm run dev` в ./frontend)",
  },
];

const waitFor = async (check: Check, deadline: number): Promise<void> => {
  const context = await request.newContext({ ignoreHTTPSErrors: true });
  let lastError = "нет ответа";

  try {
    while (Date.now() < deadline) {
      try {
        const response = await context.get(check.url, { timeout: 5_000 });
        if (response.ok()) {
          return;
        }
        lastError = `HTTP ${response.status()}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message.split("\n")[0] : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  } finally {
    await context.dispose();
  }

  throw new Error(
    `[globalSetup] ${check.name} не готов: ${check.url} — ${lastError}\n` +
      `Поднимите стек: ${check.hint}`,
  );
};

const globalSetup = async (): Promise<void> => {
  const files = ensureTestFiles();
  const names = Object.values(files).flatMap((file) => (file ? [file.name] : []));
  console.log(`[globalSetup] фикстуры: ${names.join(", ")}`);

  const deadline = Date.now() + STACK_READY_TIMEOUT_MS;
  // Последовательно, чтобы в логе было видно, что именно не поднялось.
  for (const check of CHECKS) {
    await waitFor(check, deadline);
    console.log(`[globalSetup] ${check.name} готов: ${check.url}`);
  }
};

export default globalSetup;
