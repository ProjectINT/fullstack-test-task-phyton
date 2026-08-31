import { expect, test } from "../src/fixtures";
import { API_URL } from "../src/config";
import { testFile } from "../src/test-files";

test.describe("phase 0: инфраструктура", () => {
  test("бэкенд отвечает на GET /files", async ({ api }) => {
    const files = await api.listFiles({ limit: 1 });
    expect(Array.isArray(files)).toBe(true);
  });

  test("страница приложения открывается", async ({ appPage }) => {
    await expect(appPage).toHaveTitle(/Тестовое задание/);
    await expect(appPage.getByRole("heading", { name: "Файлы" })).toBeVisible();
    await expect(appPage.getByRole("heading", { name: "Алерты" })).toBeVisible();
  });

  test("фикстуры-файлы генерируются на диске", async () => {
    const clean = testFile("clean");
    const big = testFile("big");
    expect(clean.size).toBeGreaterThan(0);
    expect(big.size).toBe(11 * 1024 * 1024);
  });

  // Проверяет весь конвейер фикстур: загрузка через API, ожидание воркера,
  // алерт и авто-очистка в teardown.
  test("uploadedFile доходит до processed и порождает info-алерт", async ({
    api,
    uploadedFile,
  }) => {
    expect(uploadedFile.processing_status).toBe("processed");
    expect(uploadedFile.scan_status).toBe("clean");
    expect(uploadedFile.requires_attention).toBe(false);

    const alert = await api.waitForAlert(uploadedFile.id);
    expect(alert.level).toBe("info");
    expect(alert.message).toBe("File processed successfully");
  });

  test("uploadFile чистит за собой созданные файлы", async ({ api, uploadFile }) => {
    const created = await uploadFile({ fixture: "clean", label: "cleanup" });
    expect(api.createdFileIds.has(created.id)).toBe(true);

    await api.cleanup();

    const response = await api.getFileResponse(created.id);
    expect(response.status()).toBe(404);
  });

  test("API-хелпер указывает на ожидаемый бэкенд", async () => {
    expect(API_URL).toMatch(/^https?:\/\//);
  });
});
