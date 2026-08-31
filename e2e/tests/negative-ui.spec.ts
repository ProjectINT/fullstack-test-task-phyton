import { expect, test, uniqueTitle } from "../src/fixtures";
import { testFile } from "../src/test-files";

const clean = testFile("clean");
const empty = testFile("empty");

/** `ApiError` kind=network → `toUserMessage` (frontend/src/lib/errors.ts). */
const NETWORK_ERROR = "Сервер недоступен. Проверьте соединение.";

test.describe("phase 4: негативные сценарии UI", () => {
  test("пустой файл: бэкенд отвечает 400, ошибка видна в модалке", async ({
    api,
    dashboard,
  }, testInfo) => {
    const title = uniqueTitle(testInfo, "empty");
    const modal = await dashboard.openUploadModal();
    await modal.fill({ title, filePath: empty.path });

    const [response] = await Promise.all([
      dashboard.page.waitForResponse(
        (res) => res.request().method() === "POST" && res.url().endsWith("/files"),
      ),
      modal.submit(),
    ]);
    expect(response.status()).toBe(400);

    // HTTP-ошибку с detail UI показывает текстом бэкенда как есть.
    await expect(modal.error).toHaveText("File is empty");
    await modal.expectOpen();
    await expect(modal.submitButton).toHaveText("Сохранить");
    await expect(modal.submitButton).toBeEnabled();

    // Отклонённая загрузка не создала запись.
    await modal.cancelButton.click();
    await dashboard.refresh();
    await expect(dashboard.fileRow(title).root).toHaveCount(0);
    expect(await api.findFileByTitle(title)).toBeUndefined();
  });

  test("недоступный бэкенд: сабмит формы показывает сетевую ошибку", async ({
    dashboard,
  }, testInfo) => {
    await dashboard.failUpload();

    const title = uniqueTitle(testInfo, "upload-offline");
    const modal = await dashboard.openUploadModal();
    await modal.fill({ title, filePath: clean.path });
    await modal.submit();

    await expect(modal.error).toHaveText(NETWORK_ERROR);
    await modal.expectOpen();
    await expect(modal.submitButton).toBeEnabled();
    // Форма не сброшена — можно повторить попытку теми же данными.
    await expect(modal.titleInput).toHaveValue(title);
  });

  /**
   * Первую страницу рендерит серверный компонент (app/page.tsx), и его запрос
   * идёт из процесса Next мимо браузера — `page.route` его не видит, поэтому
   * экран `app/error.tsx` («Не удалось загрузить данные») из теста не
   * воспроизводится. Проверяем клиентский путь: ошибку обновления списков.
   */
  test("недоступный бэкенд: обе таблицы показывают ошибку обновления", async ({ dashboard }) => {
    await dashboard.failLists();
    await dashboard.refresh();

    await expect(dashboard.files.error).toHaveText(NETWORK_ERROR);
    await expect(dashboard.alerts.error).toHaveText(NETWORK_ERROR);
    // Данные, отрисованные сервером, остаются на экране — таблица не пустеет.
    await expect(dashboard.files.table).toBeVisible();
  });

  test("HTTP-ошибка бэкенда показывается со статусом ответа", async ({ dashboard }) => {
    // Ответ без `detail` — сообщение собирается из статуса.
    await dashboard.failLists({ status: 500 });
    await dashboard.refresh();

    await expect(dashboard.files.error).toHaveText("Не удалось выполнить запрос (500)");
    await expect(dashboard.alerts.error).toHaveText("Не удалось выполнить запрос (500)");
  });

  test("во время сабмита кнопка задизейблена и показывает «Загрузка...»", async ({
    api,
    dashboard,
  }, testInfo) => {
    const delayMs = 3_000;
    await dashboard.delayUpload(delayMs);

    const title = uniqueTitle(testInfo, "submitting");
    const modal = await dashboard.openUploadModal();
    await modal.fill({ title, filePath: clean.path });
    await modal.submit();

    await expect(modal.submitButton).toHaveText("Загрузка...");
    await expect(modal.submitButton).toBeDisabled();

    // Задержка кончилась, запрос дошёл до бэкенда — модалка закрылась сама.
    await modal.expectClosed();
    // Файл реально создан; заодно попадает в авто-очистку teardown.
    await api.waitForFileByTitle(title);
  });

  // Загрузка 101 МБ через браузер — самый долгий сценарий фазы.
  test("файл больше 100 МБ отклоняется бэкендом", async ({ api, dashboard }, testInfo) => {
    test.slow();
    const huge = testFile("huge");

    const title = uniqueTitle(testInfo, "too-large");
    const modal = await dashboard.openUploadModal();
    await modal.fill({ title, filePath: huge.path });
    await modal.submit();

    // Бэкенд обрывает приём, как только превышен max_file_size, и отвечает 413 —
    // его detail и показывает модалка.
    await expect(modal.error).toHaveText("File is too large");
    await modal.expectOpen();
    await expect(modal.submitButton).toBeEnabled();

    await modal.cancelButton.click();
    expect(await api.findFileByTitle(title)).toBeUndefined();
  });
});
