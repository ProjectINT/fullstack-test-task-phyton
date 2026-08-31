import fs from "node:fs";

import { API_URL } from "../src/config";
import { expect, test, uniqueTitle } from "../src/fixtures";
import { testFile, testFileContent } from "../src/test-files";

const clean = testFile("clean");
const exe = testFile("exe");

/** Несуществующий, но синтаксически валидный id файла. */
const MISSING_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Побайтовое сравнение. `toEqual` на буферах печатает дамп целиком,
 * поэтому сначала сверяем размер, а равенство проверяем булевым флагом.
 */
const expectSameBytes = (actual: Buffer, expected: Buffer, what: string): void => {
  expect(actual.length, `${what}: размер скачанного файла`).toBe(expected.length);
  expect(actual.equals(expected), `${what}: содержимое разошлось с загруженным`).toBe(true);
};

test.describe("phase 5: скачивание", () => {
  test("UI: «Скачать» отдаёт файл под original_name и байт-в-байт", async ({
    api,
    dashboard,
    uploadFile,
  }, testInfo) => {
    const title = uniqueTitle(testInfo, "download");
    const file = await uploadFile({ fixture: "clean", title });

    await dashboard.refresh();
    const row = dashboard.fileRow(title);
    await expect(row.root).toBeVisible();
    // Ссылка ведёт прямо в бэкенд (`fileDownloadUrl`), без прокси через Next.
    await expect(row.downloadLink).toHaveAttribute(
      "href",
      `${API_URL}/files/${file.id}/download`,
    );

    const downloadPromise = dashboard.page.waitForEvent("download");
    await row.downloadLink.click();
    const download = await downloadPromise;

    // Имя берётся из Content-Disposition, то есть из `original_name`, не из title.
    expect(download.suggestedFilename()).toBe(clean.name);

    const savedPath = await download.path();
    expect(savedPath, "браузер не сохранил файл").not.toBeNull();
    expectSameBytes(fs.readFileSync(savedPath!), testFileContent("clean"), "UI-скачивание");

    // Скачивание — операция только на чтение: запись остаётся на месте.
    expect((await api.getFile(file.id)).original_name).toBe(clean.name);
  });

  test("API: 200, Content-Type и Content-Disposition по данным записи", async ({
    api,
    uploadFile,
  }) => {
    const file = await uploadFile({ fixture: "clean" });

    const response = await api.downloadResponse(file.id);
    expect(response.status()).toBe(200);

    const headers = response.headers();
    // Starlette дописывает charset к текстовым типам, поэтому сверяем префикс.
    expect(headers["content-type"]).toMatch(new RegExp(`^${file.mime_type}\\b`));
    expect(headers["content-disposition"]).toBe(`attachment; filename="${clean.name}"`);
    expect(Number(headers["content-length"])).toBe(clean.size);

    expectSameBytes(await response.body(), testFileContent("clean"), "API-скачивание");
  });

  test("API: бинарный файл отдаётся без искажений", async ({ api, uploadFile }) => {
    const file = await uploadFile({ fixture: "exe" });

    const response = await api.downloadResponse(file.id);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/^application\/octet-stream\b/);
    expect(response.headers()["content-disposition"]).toBe(
      `attachment; filename="${exe.name}"`,
    );

    expectSameBytes(await response.body(), testFileContent("exe"), "бинарное скачивание");
  });

  test("API: имя файла в Content-Disposition — исходное, а не title", async ({
    api,
    uploadFile,
  }, testInfo) => {
    const fileName = "report v2.txt";
    const title = uniqueTitle(testInfo, "renamed");
    const file = await uploadFile({
      fixture: "clean",
      title,
      fileName,
      content: testFileContent("clean"),
    });
    expect(file.original_name).toBe(fileName);

    const response = await api.downloadResponse(file.id);
    expect(response.status()).toBe(200);
    // Пробел в имени Starlette не пропускает в `filename=`, а кодирует по RFC 5987.
    expect(response.headers()["content-disposition"]).toBe(
      "attachment; filename*=utf-8''report%20v2.txt",
    );
  });

  test("API: несуществующий id → 404", async ({ api }) => {
    const response = await api.downloadResponse(MISSING_ID);
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ detail: "File not found" });
  });

  test("API: удалённый файл больше не скачивается", async ({ api, uploadFile }) => {
    const file = await uploadFile({ fixture: "clean", label: "deleted" });
    expect((await api.downloadResponse(file.id)).status()).toBe(200);

    await api.deleteFile(file.id);

    expect((await api.downloadResponse(file.id)).status()).toBe(404);
  });
});
