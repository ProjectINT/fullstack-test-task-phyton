import { expect, test } from "../src/fixtures";

test.describe("phase 1: smoke UI", () => {
  test("страница открывается: заголовок, секции и кнопки на месте", async ({ dashboard }) => {
    await expect(dashboard.page).toHaveTitle("Тестовое задание Fullstack");

    await expect(dashboard.heading).toBeVisible();
    await expect(dashboard.subtitle).toBeVisible();

    await expect(dashboard.files.heading).toBeVisible();
    await expect(dashboard.alerts.heading).toBeVisible();

    await expect(dashboard.refreshButton).toBeEnabled();
    await expect(dashboard.addFileButton).toBeEnabled();

    // Данные пришли — баннера ошибки быть не должно ни в одной секции.
    await expect(dashboard.files.error).toHaveCount(0);
    await expect(dashboard.alerts.error).toHaveCount(0);
  });

  test("обе таблицы отрисованы с ожидаемыми колонками", async ({ dashboard }) => {
    await expect(dashboard.files.table).toBeVisible();
    await expect(dashboard.files.columnHeaders).toHaveText([
      "Название",
      "Файл",
      "MIME",
      "Размер",
      "Статус",
      "Проверка",
      "Создан",
      // Последняя колонка — действия, заголовка у неё нет.
      "",
    ]);

    await expect(dashboard.alerts.table).toBeVisible();
    await expect(dashboard.alerts.columnHeaders).toHaveText([
      "Файл",
      "Уровень",
      "Сообщение",
      "Создан",
    ]);
  });

  // БД общая, пустой её не гарантировать — поэтому пустую выборку отдаёт мок,
  // а проверяется реакция UI на неё.
  test("пустая выборка показывает заглушки вместо строк", async ({ dashboard }) => {
    await dashboard.mockLists({ files: [], alerts: [] });
    await dashboard.refresh();

    await expect(dashboard.files.emptyRow).toBeVisible();
    await expect(dashboard.files.counter).toHaveText("0");
    await expect(dashboard.alerts.emptyRow).toBeVisible();
    await expect(dashboard.alerts.counter).toHaveText("0");
  });

  // uploadedFile гарантирует, что обе таблицы непустые: обработанный файл
  // порождает и строку в «Файлах», и info-алерт.
  test("счётчики-бейджи соответствуют числу строк", async ({ api, uploadedFile, dashboard }) => {
    await api.waitForAlert(uploadedFile.id);
    await dashboard.refresh();

    for (const section of [dashboard.files, dashboard.alerts]) {
      const rows = await section.dataRowCount();
      expect(rows, `в секции «${section.title}» нет строк`).toBeGreaterThan(0);
      await expect(section.counter).toHaveText(String(rows));
    }
  });

  test("спиннер обновления появляется и исчезает", async ({ dashboard }) => {
    // После первой загрузки страницы спиннеров быть не должно.
    await expect(dashboard.files.spinner).toBeHidden();
    await expect(dashboard.alerts.spinner).toBeHidden();

    await dashboard.delayLists(1_000);
    await dashboard.refreshButton.click();

    await expect(dashboard.files.spinner).toBeVisible();
    await expect(dashboard.alerts.spinner).toBeVisible();

    await expect(dashboard.files.spinner).toBeHidden();
    await expect(dashboard.alerts.spinner).toBeHidden();

    // Данные на месте: таблицы не сломались после перезагрузки.
    await expect(dashboard.files.table).toBeVisible();
    await expect(dashboard.alerts.table).toBeVisible();
  });
});
