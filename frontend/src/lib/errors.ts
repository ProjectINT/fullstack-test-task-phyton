/**
 * Сервис ошибок API.
 *
 * Транспортный слой (api.ts) кидает типизированную ApiError с фактами
 * (вид сбоя, статус, detail от бэкенда). Человеческий текст для UI
 * получается через toUserMessage — единственное место, где ошибки
 * превращаются в сообщения пользователю.
 */

import { t } from "@/i18n";

export type ApiErrorKind = "http" | "network" | "timeout";

type ApiErrorOptions = {
  kind: ApiErrorKind;
  path: string;
  status?: number | null;
  detail?: string | null;
};

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly path: string;
  readonly status: number | null;
  readonly detail: string | null;

  constructor({ kind, path, status = null, detail = null }: ApiErrorOptions) {
    super(detail ?? `API request failed: ${kind}${status ? ` ${status}` : ""} at ${path}`);
    this.name = "ApiError";
    this.kind = kind;
    this.path = path;
    this.status = status;
    this.detail = detail;
  }
}

export type ApiErrorLogger = (error: ApiError) => void;

let logger: ApiErrorLogger = (error) => {
  if (process.env.NODE_ENV !== "production") {
    console.error(error);
  }
};

/** Подменить логгер ошибок API (например, на Sentry). */
export const setApiErrorLogger = (fn: ApiErrorLogger) => {
  logger = fn;
};

export const logApiError = (error: ApiError) => {
  try {
    logger(error);
  } catch {
    // Сломанный логгер не должен ломать обработку ошибки.
  }
};

/** Отмена запроса (AbortController) — не ошибка, её показывать не нужно. */
export const isAbortError = (error: unknown): boolean => {
  return error instanceof DOMException && error.name === "AbortError";
};

/** Единственная точка превращения ошибки в текст для пользователя. */
export const toUserMessage = (error: unknown): string => {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case "network":
        return t("errors.network");
      case "timeout":
        return t("errors.timeout");
      case "http":
        return error.detail ?? t("errors.http", { status: error.status });
    }
  }
  return t("errors.unknown");
};
