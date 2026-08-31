import { APIResponse } from "@playwright/test";

import { Api, FileItem } from "../src/api";
import { expect, test, uniqueTitle } from "../src/fixtures";
import { testFile } from "../src/test-files";

const clean = testFile("clean");

/** Несуществующий, но синтаксически валидный id. */
const MISSING_ID = "00000000-0000-0000-0000-000000000000";
/** id, который вообще не похож на uuid: маршрут принимает любую строку. */
const GARBAGE_ID = "not-a-uuid";

/** Границы `Pagination` из `backend/src/core/pagination.py`. */
const LIMIT_MIN = 1;
const LIMIT_MAX = 1000;
const DEFAULT_LIMIT = 100;
/** Offset заведомо за концом выдачи: столько записей в тестовой БД не бывает. */
const BEYOND_END = 1_000_000;

/**
 * FastAPI отдаёт ошибку валидации query-параметров списком: проверяем и код,
 * и то, что жалоба указывает на нужный параметр, — иначе тест зелёный на
 * любой другой 422.
 */
const expectQueryValidationError = async (
  response: APIResponse,
  param: "limit" | "offset",
): Promise<void> => {
  expect(response.status(), await response.text()).toBe(422);
  const body = (await response.json()) as { detail: { loc: string[] }[] };
  expect(body.detail.map((item) => item.loc)).toContainEqual(["query", param]);
};

const expectNotFound = async (response: APIResponse): Promise<void> => {
  expect(response.status(), await response.text()).toBe(404);
  expect(await response.json()).toEqual({ detail: "File not found" });
};

const millis = (isoDate: string): number => new Date(isoDate).getTime();

/** Три файла подряд: список отсортирован по `created_at desc`, то есть в обратном порядке. */
const seedNewestFirst = async (
  uploadFile: (options: { fixture: "clean"; label: string }) => Promise<FileItem>,
  count: number,
): Promise<FileItem[]> => {
  const created: FileItem[] = [];
  for (let index = 0; index < count; index += 1) {
    created.push(await uploadFile({ fixture: "clean", label: `page-${index}` }));
  }
  return created.reverse();
};

test.describe("phase 6: GET /files — пагинация", () => {
  test("limit=1 отдаёт ровно одну запись, limit=1000 — верхняя граница", async ({
    api,
    uploadFile,
  }) => {
    // Гарантируем, что в общей БД есть хотя бы одна запись.
    await uploadFile({ fixture: "clean", label: "limits" });

    const single = await api.listFiles({ limit: LIMIT_MIN });
    expect(single).toHaveLength(1);

    const maxPage = await api.listFiles({ limit: LIMIT_MAX });
    expect(maxPage.length).toBeLessThanOrEqual(LIMIT_MAX);
    expect(maxPage.length).toBeGreaterThanOrEqual(1);
  });

  test("без параметров действует лимит по умолчанию", async ({ api }) => {
    expect((await api.listFiles()).length).toBeLessThanOrEqual(DEFAULT_LIMIT);
  });

  test("limit вне [1..1000] и отрицательный offset → 422", async ({ api }) => {
    await expectQueryValidationError(await api.listFilesResponse({ limit: 0 }), "limit");
    await expectQueryValidationError(
      await api.listFilesResponse({ limit: LIMIT_MAX + 1 }),
      "limit",
    );
    await expectQueryValidationError(await api.listFilesResponse({ limit: "abc" }), "limit");
    await expectQueryValidationError(await api.listFilesResponse({ offset: -1 }), "offset");
  });

  test("срез limit/offset идёт по created_at desc без пропусков и дублей", async ({
    api,
    uploadFile,
  }) => {
    const seeded = await seedNewestFirst(uploadFile, 3);
    const expectedIds = seeded.map((file) => file.id);

    // Чужие загрузки (параллельные воркеры) встают в голову списка и сдвигают
    // наш срез, поэтому позицию и выборку по ней сверяем одним retry-блоком.
    await expect(async () => {
      const all = await api.listFiles({ limit: LIMIT_MAX });
      const offset = all.findIndex((file) => file.id === expectedIds[0]);
      expect(offset, "seed-файлы не попали в выдачу").toBeGreaterThanOrEqual(0);

      const page = await api.listFiles({ limit: 3, offset });
      expect(page.map((file) => file.id)).toEqual(expectedIds);

      // Тот же срез по одной записи: offset двигает окно ровно на шаг.
      for (const [index, id] of expectedIds.entries()) {
        const single = await api.listFiles({ limit: 1, offset: offset + index });
        expect(single.map((file) => file.id)).toEqual([id]);
      }
    }).toPass({ timeout: 15_000, intervals: [200, 500, 1_000] });

    // Записи идут строго от новых к старым.
    const timestamps = seeded.map((file) => millis(file.created_at));
    expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);
  });

  test("offset за пределами выдачи → пустой список", async ({ api, uploadFile }) => {
    await uploadFile({ fixture: "clean", label: "offset-tail" });

    expect(await api.listFiles({ limit: LIMIT_MAX, offset: BEYOND_END })).toEqual([]);
  });
});

test.describe("phase 6: GET /files/{id}", () => {
  test("отдаёт ту же запись, что вернул POST", async ({ api, uploadFile }, testInfo) => {
    const title = uniqueTitle(testInfo, "get-one");
    const created = await uploadFile({ fixture: "clean", title });

    const fetched = await api.getFile(created.id);
    // Статусы к этому моменту мог уже поменять воркер — сверяем неизменяемое.
    expect(fetched).toMatchObject({
      id: created.id,
      title,
      original_name: clean.name,
      mime_type: clean.mimeType,
      size: clean.size,
      created_at: created.created_at,
    });
    // Метаданные считаются потоково при загрузке (`_TextStatsAnalyzer`).
    expect(fetched.metadata_json).toMatchObject({
      extension: ".txt",
      size_bytes: clean.size,
      mime_type: clean.mimeType,
      line_count: 3,
      char_count: clean.size,
    });
  });

  test("несуществующий и мусорный id → 404", async ({ api }) => {
    await expectNotFound(await api.getFileResponse(MISSING_ID));
    await expectNotFound(await api.getFileResponse(GARBAGE_ID));
  });
});

test.describe("phase 6: PATCH /files/{id}", () => {
  test("меняет только title и обновляет updated_at", async ({ api, uploadFile }, testInfo) => {
    // Ждём терминального статуса: иначе воркер параллельно правит ту же запись.
    const file = await uploadFile({ fixture: "clean", label: "patch", waitForProcessing: true });
    const newTitle = uniqueTitle(testInfo, "patched");

    const response = await api.updateFileResponse(file.id, newTitle);
    expect(response.status()).toBe(200);

    const updated = (await response.json()) as FileItem;
    expect(updated.title).toBe(newTitle);
    expect(millis(updated.updated_at)).toBeGreaterThan(millis(file.updated_at));
    // Всё остальное PATCH не трогает.
    const { title, updated_at, ...untouched } = file;
    expect(updated).toMatchObject(untouched);

    // Изменение видно и в GET, и в списке.
    expect((await api.getFile(file.id)).title).toBe(newTitle);
    expect((await api.findFileByTitle(newTitle))?.id).toBe(file.id);
  });

  test("новый title виден в UI после «Обновить»", async ({
    api,
    dashboard,
    uploadFile,
  }, testInfo) => {
    const oldTitle = uniqueTitle(testInfo, "rename-before");
    const newTitle = uniqueTitle(testInfo, "rename-after");
    const file = await uploadFile({ fixture: "clean", title: oldTitle });

    await dashboard.refresh();
    await expect(dashboard.fileRow(oldTitle).root).toBeVisible();

    await api.updateFile(file.id, newTitle);

    await dashboard.refresh();
    await expect(dashboard.fileRow(newTitle).root).toBeVisible();
    await expect(dashboard.fileRow(oldTitle).root).toHaveCount(0);
  });

  test("несуществующий id → 404, тело без title → 422", async ({ api, uploadFile }) => {
    await expectNotFound(await api.updateFileResponse(MISSING_ID, "новое название"));

    const file = await uploadFile({ fixture: "clean", label: "patch-422" });
    const response = await api.updateFileResponse(file.id, undefined as unknown as string);
    expect(response.status(), await response.text()).toBe(422);
    const body = (await response.json()) as { detail: { loc: string[] }[] };
    expect(body.detail.map((item) => item.loc)).toContainEqual(["body", "title"]);
  });
});

test.describe("phase 6: DELETE /files/{id}", () => {
  test("204, повторный GET → 404, запись пропала из списка", async ({ api, uploadFile }, testInfo) => {
    const title = uniqueTitle(testInfo, "delete");
    const file = await uploadFile({ fixture: "clean", title });
    expect(await api.findFileByTitle(title)).toBeDefined();

    const response = await api.deleteFileResponse(file.id);
    expect(response.status(), await response.text()).toBe(204);
    expect(await response.text()).toBe("");

    await expectNotFound(await api.getFileResponse(file.id));
    expect(await api.findFileByTitle(title)).toBeUndefined();
  });

  test("повторное удаление → 404", async ({ api, uploadFile }) => {
    const file = await uploadFile({ fixture: "clean", label: "delete-twice" });

    expect((await api.deleteFileResponse(file.id)).status()).toBe(204);
    await expectNotFound(await api.deleteFileResponse(file.id));
  });

  test("алерты удалённого файла уходят вместе с ним", async ({ api, uploadFile }) => {
    const file = await uploadFile({ fixture: "clean", label: "delete-cascade" });
    await api.waitForAlert(file.id);

    expect((await api.deleteFileResponse(file.id)).status()).toBe(204);

    // FK alerts.file_id объявлен с ON DELETE CASCADE (миграция a1c47f0e52b8).
    expect(await api.alertsForFile(file.id)).toEqual([]);
  });

  test("строка исчезает из UI после «Обновить»", async ({ api, dashboard, uploadFile }, testInfo) => {
    const title = uniqueTitle(testInfo, "delete-ui");
    const file = await uploadFile({ fixture: "clean", title });

    await dashboard.refresh();
    await expect(dashboard.fileRow(title).root).toBeVisible();

    await api.deleteFile(file.id);

    await dashboard.refresh();
    await expect(dashboard.fileRow(title).root).toHaveCount(0);
  });
});

test.describe("phase 6: GET /alerts", () => {
  test("отдаёт алерт файла со всеми полями контракта", async ({ api, uploadFile }, testInfo) => {
    const title = uniqueTitle(testInfo, "alert-contract");
    const file = await uploadFile({ fixture: "clean", title });

    const alert = await api.waitForAlert(file.id);
    expect(alert).toMatchObject({
      file_id: file.id,
      // title денормализован в выдачу — таблица алертов не ходит за файлом.
      file_title: title,
      level: "info",
      message: "File processed successfully",
    });
    expect(typeof alert.id).toBe("number");
    expect(millis(alert.created_at)).not.toBeNaN();
  });

  test("limit ограничивает страницу, offset сдвигает её на шаг", async ({ api, uploadFile }) => {
    // Двух алертов достаточно, чтобы у страницы был «второй элемент».
    for (const label of ["alerts-page-0", "alerts-page-1"]) {
      const file = await uploadFile({ fixture: "clean", label });
      await api.waitForAlert(file.id);
    }

    // Новые алерты встают в голову списка, поэтому сверяем страницы одним блоком.
    await expect(async () => {
      const firstPage = await api.listAlerts({ limit: 2 });
      expect(firstPage).toHaveLength(2);

      const shifted = await api.listAlerts({ limit: 1, offset: 1 });
      expect(shifted.map((alert) => alert.id)).toEqual([firstPage[1].id]);
    }).toPass({ timeout: 15_000, intervals: [200, 500, 1_000] });
  });

  test("выдача отсортирована по created_at desc", async ({ api, uploadFile }) => {
    const file = await uploadFile({ fixture: "clean", label: "alerts-order" });
    await api.waitForAlert(file.id);

    const timestamps = (await api.listAlerts({ limit: 50 })).map((alert) =>
      millis(alert.created_at),
    );
    expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);
  });

  test("limit вне [1..1000] и отрицательный offset → 422", async ({ api }) => {
    await expectQueryValidationError(await api.listAlertsResponse({ limit: 0 }), "limit");
    await expectQueryValidationError(
      await api.listAlertsResponse({ limit: LIMIT_MAX + 1 }),
      "limit",
    );
    await expectQueryValidationError(await api.listAlertsResponse({ offset: -1 }), "offset");
  });

  test("offset за пределами выдачи → пустой список", async ({ api }) => {
    expect(await api.listAlerts({ limit: LIMIT_MAX, offset: BEYOND_END })).toEqual([]);
  });
});
