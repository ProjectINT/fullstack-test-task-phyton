import { expect, test, uniqueTitle } from "../src/fixtures";
import { testFile } from "../src/test-files";

const clean = testFile("clean");

// Размер меньше килобайта — formatSize отдаёт его как «N B».
const CLEAN_SIZE_TEXT = `${clean.size} B`;
// formatDate: ru-RU, dateStyle/timeStyle: short → «31.08.2026, 12:34».
const DATE_PATTERN = /^\d{2}\.\d{2}\.\d{4},\s\d{2}:\d{2}$/;

test.describe("phase 2: загрузка файла (happy path)", () => {
  test("модалка открывается по «Добавить файл» и закрывается по «Отмена»", async ({
    dashboard,
  }) => {
    await expect(dashboard.uploadModal.root).toBeHidden();

    const modal = await dashboard.openUploadModal();
    await expect(modal.titleInput).toBeVisible();
    await expect(modal.fileInput).toBeVisible();
    await expect(modal.submitButton).toBeEnabled();
    await expect(modal.error).toHaveCount(0);

    await modal.cancelButton.click();
    await modal.expectClosed();
  });

  test("модалка закрывается крестиком", async ({ dashboard }) => {
    const modal = await dashboard.openUploadModal();

    await modal.closeButton.click();
    await modal.expectClosed();
  });

  test("поля формы сбрасываются после закрытия", async ({ dashboard }, testInfo) => {
    const modal = await dashboard.openUploadModal();
    await modal.fill({ title: uniqueTitle(testInfo, "reset"), filePath: clean.path });

    await expect(modal.titleInput).not.toHaveValue("");
    await expect(modal.fileInput).toHaveValue(new RegExp(clean.name));

    await modal.cancelButton.click();
    await modal.expectClosed();

    await dashboard.openUploadModal();
    await expect(modal.titleInput).toHaveValue("");
    await expect(modal.fileInput).toHaveValue("");
  });

  test("сабмит без названия и/или файла показывает ошибку валидации", async ({
    dashboard,
  }, testInfo) => {
    const title = uniqueTitle(testInfo, "validation");
    const modal = await dashboard.openUploadModal();

    // 1. Оба поля пустые.
    await modal.submit();
    await expect(modal.error).toHaveText("Укажите название и выберите файл");
    await modal.expectOpen();

    // 2. Есть только название.
    await modal.fill({ title });
    await modal.submit();
    await expect(modal.error).toHaveText("Укажите название и выберите файл");
    await modal.expectOpen();

    // 3. Есть только файл: название из пробелов не проходит trim.
    await modal.fill({ title: "   ", filePath: clean.path });
    await modal.submit();
    await expect(modal.error).toHaveText("Укажите название и выберите файл");
    await modal.expectOpen();

    // Ни одна из попыток не создала запись.
    await modal.cancelButton.click();
    await dashboard.refresh();
    await expect(dashboard.fileRow(title).root).toHaveCount(0);
  });

  test("загруженный файл появляется в таблице с корректными полями", async ({
    api,
    dashboard,
  }, testInfo) => {
    const title = uniqueTitle(testInfo, "ui-upload");

    const row = await dashboard.uploadViaUi({ title, filePath: clean.path });

    await expect(row.title).toHaveText(title);
    await expect(row.originalName).toHaveText(clean.name);
    await expect(row.mimeType).toHaveText(clean.mimeType);
    await expect(row.size).toHaveText(CLEAN_SIZE_TEXT);
    await expect(row.createdAt).toHaveText(DATE_PATTERN);

    // Файл реально создан на бэкенде (и попал в авто-очистку teardown).
    const file = await api.waitForFileByTitle(title);
    expect(file.original_name).toBe(clean.name);
    expect(file.mime_type).toBe(clean.mimeType);
    expect(file.size).toBe(clean.size);
  });

  test("статусная цепочка: до обработки — uploaded, после — processed/clean", async ({
    api,
    dashboard,
  }, testInfo) => {
    const title = uniqueTitle(testInfo, "status-chain");

    const row = await dashboard.uploadViaUi({ title, filePath: clean.path });

    // Воркер стартует сразу после ответа POST, поэтому «поймать» именно
    // uploaded нельзя — проверяем, что статус из начала цепочки, а не failed.
    await expect(row.status).toHaveText(/^(uploaded|processing|processed)$/);

    await dashboard.refreshUntilStatus(row, "processed");
    await expect(row.status).toHaveClass(/bg-success/);

    await expect(row.scan).toHaveText("clean");
    await expect(row.scan).toHaveClass(/bg-success/);
    // scan_details уезжают в тултип бейджа.
    await expect(row.scan).toHaveAttribute("title", "no threats found");

    const file = await api.waitForFileByTitle(title);
    expect(file.processing_status).toBe("processed");
    expect(file.scan_status).toBe("clean");
    expect(file.requires_attention).toBe(false);
  });

  // Статус uploaded живёт доли секунды, поэтому его отрисовку проверяем
  // на подменённой выдаче: сам бейдж и его вариант — обычный рендер.
  test("необработанный файл показан серыми бейджами uploaded/pending", async ({
    dashboard,
    uploadFile,
  }) => {
    const file = await uploadFile({ fixture: "clean", label: "pending-badge" });
    await dashboard.mockLists({
      files: [{ ...file, processing_status: "uploaded", scan_status: null, scan_details: null }],
    });
    await dashboard.refresh();

    const row = dashboard.fileRow(file.title);
    await expect(row.status).toHaveText("uploaded");
    await expect(row.status).toHaveClass(/bg-secondary/);
    await expect(row.scan).toHaveText("pending");
    await expect(row.scan).toHaveClass(/bg-secondary/);
  });

  test("после обработки в таблице алертов появляется info-алерт", async ({
    api,
    dashboard,
  }, testInfo) => {
    const title = uniqueTitle(testInfo, "alert");

    await dashboard.uploadViaUi({ title, filePath: clean.path });

    const file = await api.waitForFileByTitle(title);
    await api.waitForProcessed(file.id);

    // Алерт привязан к file_id — в UI он показан названием файла.
    const alert = await api.waitForAlert(file.id);
    expect(alert.file_id).toBe(file.id);
    expect(alert.level).toBe("info");
    expect(alert.message).toBe("File processed successfully");

    await dashboard.refresh();

    const alertRow = dashboard.alertRow(title);
    await expect(alertRow.root).toBeVisible();
    await expect(alertRow.fileButton).toHaveText(title);
    await expect(alertRow.level).toHaveText("info");
    await expect(alertRow.message).toHaveText("File processed successfully");
    await expect(alertRow.createdAt).toHaveText(DATE_PATTERN);
  });
});
