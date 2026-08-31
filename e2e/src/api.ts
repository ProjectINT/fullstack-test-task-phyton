import fs from "node:fs";
import path from "node:path";

import { APIRequestContext, APIResponse, expect } from "@playwright/test";

import { API_URL, PROCESSING_TIMEOUT_MS } from "./config";
import { TestFile } from "./test-files";

export type ProcessingStatus = "uploaded" | "processing" | "processed" | "failed";
export type ScanStatus = "clean" | "suspicious" | "failed";
export type AlertLevel = "info" | "warning" | "critical";

export type FileItem = {
  id: string;
  title: string;
  original_name: string;
  mime_type: string;
  size: number;
  processing_status: ProcessingStatus;
  scan_status: ScanStatus | null;
  scan_details: string | null;
  metadata_json: Record<string, unknown> | null;
  requires_attention: boolean;
  created_at: string;
  updated_at: string;
};

export type AlertItem = {
  id: number;
  file_id: string;
  level: AlertLevel;
  message: string;
  created_at: string;
};

export type UploadOptions = {
  title: string;
  /** Готовая фикстура из `test-files.ts`. */
  file?: TestFile;
  /** Либо путь к файлу вручную... */
  filePath?: string;
  /** ...либо контент прямо в тесте. */
  content?: Buffer | string;
  /** Переопределяет имя файла (нужно, чтобы играть с расширениями). */
  fileName?: string;
  /** Переопределяет MIME — браузер такое не позволяет, а API даёт (фаза 3). */
  mimeType?: string;
};

const TERMINAL_STATUSES: ProcessingStatus[] = ["processed", "failed"];

function resolvePayload(options: UploadOptions): {
  name: string;
  mimeType: string;
  buffer: Buffer;
} {
  if (options.content !== undefined) {
    const name = options.fileName ?? options.file?.name;
    if (!name) {
      throw new Error("uploadFile: при передаче `content` нужно указать `fileName`");
    }
    return {
      name,
      mimeType: options.mimeType ?? options.file?.mimeType ?? "application/octet-stream",
      buffer: Buffer.isBuffer(options.content) ? options.content : Buffer.from(options.content),
    };
  }

  const filePath = options.filePath ?? options.file?.path;
  if (!filePath) {
    throw new Error("uploadFile: нужен один из `file`, `filePath` или `content`");
  }

  return {
    name: options.fileName ?? options.file?.name ?? path.basename(filePath),
    mimeType: options.mimeType ?? options.file?.mimeType ?? "application/octet-stream",
    buffer: fs.readFileSync(filePath),
  };
}

/**
 * Тонкая обёртка над FastAPI-бэком поверх `request`-контекста Playwright.
 * Всё, что она создала, помнит в `createdFileIds` — фикстура чистит это в teardown.
 */
export class Api {
  readonly createdFileIds = new Set<string>();

  constructor(
    private readonly request: APIRequestContext,
    private readonly baseURL: string = API_URL,
  ) {}

  private url(path: string): string {
    return `${this.baseURL}${path}`;
  }

  // --- files ---------------------------------------------------------------

  /** Сырой POST /files — для негативных сценариев, где нужен код ответа. */
  async uploadResponse(options: UploadOptions): Promise<APIResponse> {
    const { name, mimeType, buffer } = resolvePayload(options);
    const response = await this.request.post(this.url("/files"), {
      multipart: {
        title: options.title,
        file: { name, mimeType, buffer },
      },
    });

    if (response.status() === 201) {
      const created = (await response.json()) as FileItem;
      this.createdFileIds.add(created.id);
    }
    return response;
  }

  /** POST /files, падает если не 201. */
  async upload(options: UploadOptions): Promise<FileItem> {
    const response = await this.uploadResponse(options);
    expect(response.status(), `POST /files: ${await response.text()}`).toBe(201);
    return (await response.json()) as FileItem;
  }

  async listFilesResponse(params: { limit?: number; offset?: number } = {}): Promise<APIResponse> {
    return this.request.get(this.url("/files"), { params });
  }

  async listFiles(params: { limit?: number; offset?: number } = {}): Promise<FileItem[]> {
    const response = await this.listFilesResponse(params);
    expect(response.ok(), `GET /files: ${await response.text()}`).toBeTruthy();
    return (await response.json()) as FileItem[];
  }

  async getFileResponse(fileId: string): Promise<APIResponse> {
    return this.request.get(this.url(`/files/${fileId}`));
  }

  async getFile(fileId: string): Promise<FileItem> {
    const response = await this.getFileResponse(fileId);
    expect(response.ok(), `GET /files/${fileId}: ${await response.text()}`).toBeTruthy();
    return (await response.json()) as FileItem;
  }

  async updateFileResponse(fileId: string, title: string): Promise<APIResponse> {
    return this.request.patch(this.url(`/files/${fileId}`), { data: { title } });
  }

  async downloadResponse(fileId: string): Promise<APIResponse> {
    return this.request.get(this.url(`/files/${fileId}/download`));
  }

  async deleteFileResponse(fileId: string): Promise<APIResponse> {
    const response = await this.request.delete(this.url(`/files/${fileId}`));
    if (response.status() === 204 || response.status() === 404) {
      this.createdFileIds.delete(fileId);
    }
    return response;
  }

  /** Идемпотентное удаление: 404 считаем успехом (файл уже убрали). */
  async deleteFile(fileId: string): Promise<void> {
    const response = await this.deleteFileResponse(fileId);
    expect(
      [204, 404],
      `DELETE /files/${fileId}: ${response.status()} ${await response.text()}`,
    ).toContain(response.status());
  }

  /** Удаляет всё, что этот клиент создал. Ошибки не роняют teardown. */
  async cleanup(): Promise<void> {
    const ids = [...this.createdFileIds];
    this.createdFileIds.clear();
    await Promise.all(
      ids.map(async (id) => {
        try {
          await this.request.delete(this.url(`/files/${id}`));
        } catch {
          // Бэк мог уже уйти — teardown не должен маскировать результат теста.
        }
      }),
    );
  }

  // --- ожидание асинхронной обработки --------------------------------------

  /**
   * Ждёт, пока воркер доведёт файл до терминального статуса.
   * UI сам не обновляется, поэтому ожидание живёт на уровне API.
   */
  async waitForTerminalStatus(fileId: string, timeout = PROCESSING_TIMEOUT_MS): Promise<FileItem> {
    let last: FileItem | undefined;
    await expect
      .poll(
        async () => {
          last = await this.getFile(fileId);
          return last.processing_status;
        },
        {
          timeout,
          intervals: [200, 300, 500, 1000],
          message: `файл ${fileId} не дошёл до processed/failed за ${timeout} мс`,
        },
      )
      .toMatch(/^(processed|failed)$/);
    return last!;
  }

  /** То же, но требует именно `processed`. */
  async waitForProcessed(fileId: string, timeout = PROCESSING_TIMEOUT_MS): Promise<FileItem> {
    const file = await this.waitForTerminalStatus(fileId, timeout);
    expect(file.processing_status, `scan_details: ${file.scan_details}`).toBe("processed");
    return file;
  }

  // --- alerts --------------------------------------------------------------

  async listAlertsResponse(params: { limit?: number; offset?: number } = {}): Promise<APIResponse> {
    return this.request.get(this.url("/alerts"), { params });
  }

  async listAlerts(params: { limit?: number; offset?: number } = {}): Promise<AlertItem[]> {
    const response = await this.listAlertsResponse(params);
    expect(response.ok(), `GET /alerts: ${await response.text()}`).toBeTruthy();
    return (await response.json()) as AlertItem[];
  }

  /**
   * Алерты конкретного файла. Серверного фильтра по `file_id` нет,
   * поэтому забираем страницу максимального размера и фильтруем на клиенте.
   */
  async alertsForFile(fileId: string): Promise<AlertItem[]> {
    const alerts = await this.listAlerts({ limit: 1000 });
    return alerts.filter((alert) => alert.file_id === fileId);
  }

  /** Ждёт появления алерта по файлу — он пишется в одной транзакции с результатом скана. */
  async waitForAlert(fileId: string, timeout = PROCESSING_TIMEOUT_MS): Promise<AlertItem> {
    let found: AlertItem[] = [];
    await expect
      .poll(
        async () => {
          found = await this.alertsForFile(fileId);
          return found.length;
        },
        { timeout, intervals: [200, 300, 500, 1000], message: `нет алерта по файлу ${fileId}` },
      )
      .toBeGreaterThan(0);
    return found[0];
  }
}

export { TERMINAL_STATUSES };
