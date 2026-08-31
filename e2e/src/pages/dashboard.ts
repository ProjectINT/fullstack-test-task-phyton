import { Locator, Page, Route, expect } from "@playwright/test";

import { API_URL, APP_PATH, PROCESSING_TIMEOUT_MS } from "../config";

/**
 * Секция-карточка с таблицей («Файлы» или «Алерты»): заголовок, счётчик-бейдж,
 * спиннер обновления и сама таблица.
 */
export class TableSection {
  readonly root: Locator;
  readonly heading: Locator;
  /** Бейдж-счётчик рядом с заголовком секции. */
  readonly counter: Locator;
  /** Спиннер «идёт обновление» в шапке секции. */
  readonly spinner: Locator;
  readonly table: Locator;
  readonly columnHeaders: Locator;
  /** Строки `tbody` — в пустом состоянии здесь одна строка-заглушка. */
  readonly rows: Locator;
  readonly emptyRow: Locator;
  readonly error: Locator;

  constructor(
    page: Page,
    readonly title: string,
    readonly emptyText: string,
  ) {
    this.root = page.locator(".card").filter({
      has: page.getByRole("heading", { name: title, exact: true, level: 2 }),
    });
    this.heading = this.root.getByRole("heading", { name: title, exact: true, level: 2 });
    this.counter = this.root.locator(".card-header .badge");
    this.spinner = this.root.locator(".card-header [role='status']");
    this.table = this.root.getByRole("table");
    this.columnHeaders = this.table.locator("thead th");
    this.rows = this.table.locator("tbody tr");
    this.emptyRow = this.table.getByRole("cell", { name: emptyText, exact: true });
    this.error = this.root.locator(".alert-danger");
  }

  /** Число в бейдже-счётчике. */
  async counterValue(): Promise<number> {
    return Number((await this.counter.innerText()).trim());
  }

  /** Строки с данными: строка-заглушка пустого состояния не считается. */
  async dataRowCount(): Promise<number> {
    return (await this.emptyRow.count()) > 0 ? 0 : this.rows.count();
  }
}


/** Строка таблицы файлов: ячейки в том же порядке, что и колонки `FilesTable`. */
export class FileRow {
  readonly cells: Locator;
  readonly title: Locator;
  readonly originalName: Locator;
  readonly mimeType: Locator;
  readonly size: Locator;
  /** Бейдж `processing_status`: uploaded / processing / processed / failed. */
  readonly status: Locator;
  /** Бейдж `scan_status`; в его `title` лежат `scan_details`. */
  readonly scan: Locator;
  readonly createdAt: Locator;
  /** Ссылка «Скачать»: react-bootstrap рендерит `<a href>` с `role="button"`. */
  readonly downloadLink: Locator;
  readonly renameButton: Locator;
  readonly deleteButton: Locator;

  constructor(readonly root: Locator) {
    this.cells = root.locator("td");
    this.title = this.cells.nth(0);
    this.originalName = this.cells.nth(1);
    this.mimeType = this.cells.nth(2);
    this.size = this.cells.nth(3);
    this.status = this.cells.nth(4).locator(".badge");
    this.scan = this.cells.nth(5).locator(".badge");
    this.createdAt = this.cells.nth(6);
    this.downloadLink = root.getByRole("button", { name: "Скачать" });
    this.renameButton = root.getByRole("button", { name: "Переименовать" });
    this.deleteButton = root.getByRole("button", { name: "Удалить" });
  }
}

/** Строка таблицы алертов: файл (кнопка-ссылка с title файла), уровень, сообщение, дата. */
export class AlertRow {
  readonly cells: Locator;
  readonly fileButton: Locator;
  readonly level: Locator;
  readonly message: Locator;
  readonly createdAt: Locator;

  constructor(readonly root: Locator) {
    this.cells = root.locator("td");
    this.fileButton = this.cells.nth(0).getByRole("button");
    this.level = this.cells.nth(1).locator(".badge");
    this.message = this.cells.nth(2);
    this.createdAt = this.cells.nth(3);
  }
}

/** Сколько ждём гидратации React после отрисовки серверной разметки. */
const HYDRATION_TIMEOUT_MS = 15_000;

/** Модалка «Добавить файл». */
export class UploadModal {
  readonly root: Locator;
  readonly title: Locator;
  readonly titleInput: Locator;
  readonly fileInput: Locator;
  readonly cancelButton: Locator;
  readonly submitButton: Locator;
  /** Крестик в шапке модалки. */
  readonly closeButton: Locator;
  readonly error: Locator;

  constructor(readonly page: Page) {
    this.root = page.getByRole("dialog").filter({ has: page.locator(".modal-title") });
    this.title = this.root.locator(".modal-title");
    this.titleInput = this.root.getByPlaceholder("Например, Договор с подрядчиком");
    this.fileInput = this.root.locator("input[type='file']");
    this.cancelButton = this.root.getByRole("button", { name: "Отмена" });
    this.submitButton = this.root.getByRole("button", { name: /Сохранить|Загрузка\.\.\./ });
    this.closeButton = this.root.locator(".btn-close");
    this.error = this.root.locator(".alert-danger");
  }

  async expectOpen(): Promise<void> {
    await expect(this.root).toBeVisible();
    await expect(this.title).toHaveText("Добавить файл");
  }

  async expectClosed(): Promise<void> {
    await expect(this.root).toBeHidden();
  }

  /** Заполняет форму; любое из полей можно пропустить (сценарии валидации). */
  async fill({ title, filePath }: { title?: string; filePath?: string }): Promise<void> {
    if (title !== undefined) {
      await this.titleInput.fill(title);
    }
    if (filePath !== undefined) {
      await this.fileInput.setInputFiles(filePath);
    }
  }

  async submit(): Promise<void> {
    await this.submitButton.click();
  }
}

/** Главная (и единственная) страница приложения. */
export class DashboardPage {
  readonly heading: Locator;
  readonly subtitle: Locator;
  readonly refreshButton: Locator;
  readonly addFileButton: Locator;
  readonly files: TableSection;
  readonly alerts: TableSection;
  readonly uploadModal: UploadModal;

  constructor(readonly page: Page) {
    this.heading = page.getByRole("heading", { name: "Управление файлами", level: 1 });
    this.subtitle = page.getByText(
      "Загрузка файлов, просмотр статусов обработки и ленты алертов.",
    );
    this.refreshButton = page.getByRole("button", { name: "Обновить" });
    this.addFileButton = page.getByRole("button", { name: "Добавить файл" });
    this.files = new TableSection(page, "Файлы", "Файлы пока не загружены");
    this.alerts = new TableSection(page, "Алерты", "Алертов пока нет");
    this.uploadModal = new UploadModal(page);
  }

  async goto(): Promise<void> {
    await this.page.goto(APP_PATH, { waitUntil: "domcontentloaded" });
    await expect(this.heading).toBeVisible();
    await this.waitForHydration();
  }

  /**
   * Разметку страницы отдаёт сервер (`app/page.tsx`), а обработчики React
   * вешает при гидратации — клик в этот промежуток пропадает молча. Под
   * нагрузкой (полный прогон в 16 воркеров) окно расширяется и даёт flaky
   * «модалка не открылась». Гидратированный узел React помечает свойствами
   * `__reactFiber$…`/`__reactProps$…` — ждём их на кнопке из шапки.
   */
  private async waitForHydration(): Promise<void> {
    const button = await this.addFileButton.elementHandle();
    try {
      await this.page.waitForFunction(
        (element) => Object.keys(element).some((key) => key.startsWith("__reactProps$")),
        button,
        { timeout: HYDRATION_TIMEOUT_MS },
      );
    } finally {
      await button?.dispose();
    }
  }

  /** Открывает модалку загрузки и дожидается её появления. */
  async openUploadModal(): Promise<UploadModal> {
    await this.addFileButton.click();
    await this.uploadModal.expectOpen();
    return this.uploadModal;
  }

  /** Строка файла по его (уникальному в рамках теста) названию. */
  fileRow(title: string): FileRow {
    return new FileRow(this.files.rows.filter({ hasText: title }));
  }

  /** Строка алерта по названию файла — в таблице алертов показан именно title. */
  alertRow(fileTitle: string): AlertRow {
    return new AlertRow(this.alerts.rows.filter({ hasText: fileTitle }));
  }

  /**
   * Загрузка через UI: заполнить форму, отправить, дождаться закрытия модалки.
   * Сам файл появляется в таблице после `onUploaded` → refetch обеих таблиц.
   */
  async uploadViaUi({ title, filePath }: { title: string; filePath: string }): Promise<FileRow> {
    const modal = await this.openUploadModal();
    await modal.fill({ title, filePath });
    await modal.submit();
    await modal.expectClosed();

    const row = this.fileRow(title);
    await expect(row.root).toBeVisible();
    return row;
  }

  /**
   * Ждёт нужный `processing_status`, прожимая «Обновить»: UI сам не знает,
   * когда воркер закончил (фоновый поллинг есть, но тест не должен на него
   * полагаться).
   */
  async refreshUntilStatus(
    row: FileRow,
    status: string,
    timeout = PROCESSING_TIMEOUT_MS,
  ): Promise<void> {
    await expect
      .poll(
        async () => {
          await this.refresh();
          return row.status.innerText();
        },
        {
          timeout,
          intervals: [500, 1000, 2000],
          message: `файл не дошёл до статуса «${status}» за ${timeout} мс`,
        },
      )
      .toBe(status);
  }

  /** «Обновить» + ожидание, пока спиннеры обеих таблиц погаснут. */
  async refresh(): Promise<void> {
    await this.refreshButton.click();
    await expect(this.files.spinner).toBeHidden();
    await expect(this.alerts.spinner).toBeHidden();
  }

  /**
   * Подменяет клиентские GET-запросы к списку файлов/алертов.
   * Браузер ходит в бэкенд напрямую (NEXT_PUBLIC_API_URL), поэтому перехват
   * работает только для запросов из клиентских компонентов — SSR-рендер
   * первой страницы идёт мимо и данные подменяются после «Обновить».
   */
  async mockLists(payload: { files?: unknown[]; alerts?: unknown[] }): Promise<void> {
    const routes: [string, unknown[] | undefined][] = [
      ["/files", payload.files],
      ["/alerts", payload.alerts],
    ];

    for (const [pathname, body] of routes) {
      if (!body) continue;
      await this.page.route(
        (url) => url.origin === API_URL && url.pathname === pathname,
        async (route) => {
          if (route.request().method() !== "GET") return route.fallback();
          await route.fulfill({ json: body });
        },
      );
    }
  }

  /** Задерживает ответы списков — чтобы поймать спиннер обновления. */
  async delayLists(delayMs: number): Promise<void> {
    await this.routeApi(["/files", "/alerts"], "GET", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      await route.fallback();
    });
  }

  /**
   * Эмулирует недоступный бэкенд для клиентских запросов списков:
   * без `status` — обрыв соединения (ApiError kind=network), со `status` —
   * HTTP-ошибка без `detail` (ApiError kind=http).
   */
  async failLists({ status }: { status?: number } = {}): Promise<void> {
    await this.routeApi(["/files", "/alerts"], "GET", async (route) => {
      if (status === undefined) return route.abort("failed");
      await route.fulfill({ status, json: {} });
    });
  }

  /** То же для загрузки файла: POST /files не доходит до бэкенда. */
  async failUpload(): Promise<void> {
    await this.routeApi(["/files"], "POST", (route) => route.abort("failed"));
  }

  /** Задерживает загрузку — чтобы поймать «Загрузка...» на кнопке сабмита. */
  async delayUpload(delayMs: number): Promise<void> {
    await this.routeApi(["/files"], "POST", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      await route.fallback();
    });
  }

  /** Перехват запросов браузера к бэкенду; чужие методы уходят дальше по цепочке. */
  private async routeApi(
    pathnames: string[],
    method: string,
    handler: (route: Route) => Promise<unknown> | unknown,
  ): Promise<void> {
    await this.page.route(
      (url) => url.origin === API_URL && pathnames.includes(url.pathname),
      async (route) => {
        if (route.request().method() !== method) return route.fallback();
        await handler(route);
      },
    );
  }
}
