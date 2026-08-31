import { ApiError, isAbortError, logApiError } from "./errors";
import type { AlertItem, FileItem } from "./types";

// В браузере доступен только NEXT_PUBLIC_* (инлайнится при сборке). На сервере
// Next (серверные компоненты) бэкенд может быть доступен по другому хосту —
// в docker-сети это http://backend:8000 — он задаётся runtime-переменной API_URL.
const API_URL =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const REQUEST_TIMEOUT_MS = 30_000;

export const DEFAULT_PAGE_SIZE = 20;

export type PageParams = {
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
};

const fail = (error: ApiError): ApiError => {
  logApiError(error);
  return error;
};

const extractDetail = async (response: Response): Promise<string | null> => {
  const data = (await response.json().catch(() => null)) as {
    detail?: unknown;
  } | null;
  const detail = data?.detail;
  if (typeof detail === "string") return detail;
  // 422 от FastAPI: detail — массив ошибок валидации с полем msg.
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item: { msg?: unknown }) =>
        typeof item?.msg === "string" ? item.msg : null
      )
      .filter((msg): msg is string => msg !== null);
    if (messages.length > 0) return messages.join("; ");
  }
  return null;
};

const request = async (path: string, init?: RequestInit): Promise<Response> => {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      cache: "no-store",
      ...init,
      signal,
    });
  } catch (error) {
    // Отмену вызывающим пробрасываем как есть — потребители фильтруют её через isAbortError.
    if (isAbortError(error)) throw error;
    const kind =
      error instanceof DOMException && error.name === "TimeoutError"
        ? "timeout"
        : "network";
    throw fail(new ApiError({ kind, path }));
  }

  if (!response.ok) {
    throw fail(
      new ApiError({
        kind: "http",
        path,
        status: response.status,
        detail: await extractDetail(response),
      })
    );
  }

  return response;
};

const apiFetch = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await request(path, init);
  return response.json() as Promise<T>;
};

/** Для запросов без тела ответа (DELETE → 204). */
const apiFetchVoid = async (path: string, init?: RequestInit): Promise<void> => {
  await request(path, init);
};

const withQuery = (path: string, { limit, offset }: PageParams) => {
  const query = new URLSearchParams();
  if (limit !== undefined) query.set("limit", String(limit));
  if (offset !== undefined) query.set("offset", String(offset));
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
};

export const getFiles = (params: PageParams = {}) => {
  return apiFetch<FileItem[]>(withQuery("/files", params), {
    signal: params.signal,
  });
};

export const getAlerts = (params: PageParams = {}) => {
  return apiFetch<AlertItem[]>(withQuery("/alerts", params), {
    signal: params.signal,
  });
};

export const uploadFile = (title: string, file: File) => {
  const formData = new FormData();
  formData.append("title", title);
  formData.append("file", file);

  return apiFetch<FileItem>("/files", { method: "POST", body: formData });
};

export const renameFile = (fileId: string, title: string) => {
  return apiFetch<FileItem>(`/files/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
};

export const deleteFile = (fileId: string) => {
  return apiFetchVoid(`/files/${fileId}`, { method: "DELETE" });
};

export const fileDownloadUrl = (fileId: string) => {
  return `${API_URL}/files/${fileId}/download`;
};
