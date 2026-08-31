import type { AlertItem, FileItem } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type PageParams = {
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    cache: "no-store",
    ...init,
  });

  if (!response.ok) {
    const detail = await response
      .json()
      .then((data: { detail?: unknown }) =>
        typeof data.detail === "string" ? data.detail : null
      )
      .catch(() => null);
    throw new Error(detail ?? `Не удалось выполнить запрос (${response.status})`);
  }

  // DELETE отвечает 204 без тела — json() упал бы.
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function withQuery(path: string, { limit, offset }: PageParams) {
  const query = new URLSearchParams();
  if (limit !== undefined) query.set("limit", String(limit));
  if (offset !== undefined) query.set("offset", String(offset));
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export function getFiles(params: PageParams = {}) {
  return apiFetch<FileItem[]>(withQuery("/files", params), {
    signal: params.signal,
  });
}

export function getAlerts(params: PageParams = {}) {
  return apiFetch<AlertItem[]>(withQuery("/alerts", params), {
    signal: params.signal,
  });
}

export function uploadFile(title: string, file: File) {
  const formData = new FormData();
  formData.append("title", title);
  formData.append("file", file);

  return apiFetch<FileItem>("/files", { method: "POST", body: formData });
}

export function renameFile(fileId: string, title: string) {
  return apiFetch<FileItem>(`/files/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

export function deleteFile(fileId: string) {
  return apiFetch<void>(`/files/${fileId}`, { method: "DELETE" });
}

export function fileDownloadUrl(fileId: string) {
  return `${API_URL}/files/${fileId}/download`;
}
