import path from "node:path";

/** Корень e2e-пакета — от него считаются пути к временным артефактам. */
export const E2E_ROOT = path.resolve(__dirname, "..");

/** Каталог для сгенерированных фикстур-файлов (в git не хранятся). */
export const FIXTURES_DIR = path.join(E2E_ROOT, ".tmp", "fixtures");

/** Приложение живёт в корне (basePath из frontend/next.config.ts убран). */
export const FRONTEND_URL = process.env.E2E_FRONTEND_URL ?? "http://localhost:3000";
export const APP_PATH = process.env.E2E_APP_PATH ?? "/";
export const APP_URL = `${FRONTEND_URL}${APP_PATH}`;

export const API_URL = process.env.E2E_API_URL ?? "http://localhost:8000";

/**
 * В CI и воркер, и бэкенд стартуют «холодными» (сборка образов, первый запрос к
 * Postgres), поэтому дефолтные ожидания там вдвое-втрое длиннее локальных.
 */
const IS_CI = !!process.env.CI;

/** Сколько ждём, пока Celery-воркер доведёт файл до терминального статуса. */
export const PROCESSING_TIMEOUT_MS = Number(
  process.env.E2E_PROCESSING_TIMEOUT_MS ?? (IS_CI ? 60_000 : 30_000),
);

/** Сколько ждём готовности стека в globalSetup. */
export const STACK_READY_TIMEOUT_MS = Number(
  process.env.E2E_STACK_READY_TIMEOUT_MS ?? (IS_CI ? 180_000 : 60_000),
);

/** Префикс в title — по нему тестовые записи отличимы от чужих в общей БД. */
export const TITLE_PREFIX = "[e2e]";
