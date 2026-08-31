import { Locator, Page, expect } from "@playwright/test";

import { API_URL, APP_PATH } from "../config";

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

/** Главная (и единственная) страница приложения. */
export class DashboardPage {
  readonly heading: Locator;
  readonly subtitle: Locator;
  readonly refreshButton: Locator;
  readonly addFileButton: Locator;
  readonly files: TableSection;
  readonly alerts: TableSection;

  constructor(readonly page: Page) {
    this.heading = page.getByRole("heading", { name: "Управление файлами", level: 1 });
    this.subtitle = page.getByText(
      "Загрузка файлов, просмотр статусов обработки и ленты алертов.",
    );
    this.refreshButton = page.getByRole("button", { name: "Обновить" });
    this.addFileButton = page.getByRole("button", { name: "Добавить файл" });
    this.files = new TableSection(page, "Файлы", "Файлы пока не загружены");
    this.alerts = new TableSection(page, "Алерты", "Алертов пока нет");
  }

  async goto(): Promise<void> {
    await this.page.goto(APP_PATH, { waitUntil: "domcontentloaded" });
    await expect(this.heading).toBeVisible();
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
    await this.page.route(
      (url) => url.origin === API_URL && ["/files", "/alerts"].includes(url.pathname),
      async (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        await route.fallback();
      },
    );
  }
}
