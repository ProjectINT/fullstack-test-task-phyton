import { Page, TestInfo, test as base, expect } from "@playwright/test";

import { Api, FileItem, UploadOptions } from "./api";
import { TITLE_PREFIX } from "./config";
import { DashboardPage } from "./pages/dashboard";
import { TestFile, TestFileKey, testFile } from "./test-files";

/**
 * Уникальный title: БД общая между тестами и прогонами, поэтому изоляция
 * держится на нём — по нему тест находит свою строку и чистит за собой.
 */
export const uniqueTitle = (testInfo: TestInfo, label = "file"): string => {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${TITLE_PREFIX} w${testInfo.workerIndex} ${label} ${Date.now()}-${suffix}`;
};

export type UploadFixtureOptions = Omit<UploadOptions, "title"> & {
  /** Готовая фикстура по ключу — короче, чем `file: testFile('clean')`. */
  fixture?: TestFileKey;
  /** Свой title; по умолчанию генерируется уникальный. */
  title?: string;
  /** Метка внутри автоматического title — чтобы отличать файлы в одном тесте. */
  label?: string;
  /** Дождаться терминального статуса перед возвратом. По умолчанию нет. */
  waitForProcessing?: boolean;
};

export type UploadFile = (options?: UploadFixtureOptions) => Promise<FileItem>;

type Fixtures = {
  /** API-клиент с авто-очисткой всего, что он создал. */
  api: Api;
  /** Загружает файл через API и регистрирует его на удаление в teardown. */
  uploadFile: UploadFile;
  /** Уже загруженный чистый файл (`clean.txt`), доведённый до `processed`. */
  uploadedFile: FileItem;
  /** Открытая и прогруженная страница приложения. */
  appPage: Page;
  /** Page object главной страницы, уже открытой в браузере. */
  dashboard: DashboardPage;
};

export const test = base.extend<Fixtures>({
  api: async ({ request }, use) => {
    const api = new Api(request);
    await use(api);
    await api.cleanup();
  },

  uploadFile: async ({ api }, use, testInfo) => {
    const upload: UploadFile = async (options = {}) => {
      const { fixture, title, label, waitForProcessing, ...rest } = options;
      const file: TestFile | undefined = rest.file ?? (fixture ? testFile(fixture) : undefined);

      const created = await api.upload({
        ...rest,
        file,
        title: title ?? uniqueTitle(testInfo, label ?? file?.name ?? "file"),
      });

      return waitForProcessing ? api.waitForTerminalStatus(created.id) : created;
    };

    await use(upload);
  },

  uploadedFile: async ({ uploadFile }, use) => {
    await use(await uploadFile({ fixture: "clean", waitForProcessing: true }));
  },

  appPage: async ({ page }, use) => {
    await gotoApp(page);
    await use(page);
  },

  dashboard: async ({ page }, use) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await use(dashboard);
  },
});

/** Переход на приложение с ожиданием первой отрисовки. */
export const gotoApp = async (page: Page): Promise<DashboardPage> => {
  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  return dashboard;
};

export { DashboardPage, expect };
