# E2E-тесты (Playwright)

Отдельный npm-пакет, чтобы Playwright не попадал в зависимости фронтенда.
План по фазам — [`docs/e2e-test-plan.md`](../docs/e2e-test-plan.md).

## Подготовка

```bash
# 1. Поднять стек из корня репозитория
docker compose -f docker-compose.dev.yml up -d
docker exec -it backend alembic upgrade head

# 2. Установить зависимости и браузер
cd e2e
npm install
npm run install:browsers
```

## Запуск

```bash
npm test                 # весь набор
npm test -- --headed     # с окном браузера
npm run test:ui          # интерактивный режим
npm run report           # HTML-отчёт последнего прогона
```

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `E2E_FRONTEND_URL` | `http://localhost:3000` | origin фронтенда |
| `E2E_APP_PATH` | `/` | путь до приложения (если появится `basePath`) |
| `E2E_API_URL` | `http://localhost:8000` | бэкенд FastAPI |
| `E2E_PROCESSING_TIMEOUT_MS` | `30000` | ожидание Celery-воркера |
| `E2E_STACK_READY_TIMEOUT_MS` | `60000` | ожидание готовности стека в globalSetup |

## Структура

```
e2e/
├── playwright.config.ts   # baseURL, trace/screenshot, проект chromium
├── global-setup.ts        # генерация фикстур + ожидание backend и frontend
├── src/
│   ├── config.ts          # URL'ы, таймауты, префикс тестовых title
│   ├── test-files.ts      # фикстуры-файлы, генерируются на лету (в git не лежат)
│   ├── api.ts             # клиент бэкенда поверх request-контекста Playwright
│   ├── fixtures.ts        # test.extend: api, uploadFile, uploadedFile, appPage, dashboard
│   └── pages/
│       └── dashboard.ts   # page object главной страницы (секции, строки, модалка загрузки)
└── tests/
    ├── smoke.spec.ts      # фаза 0: инфраструктура жива
    ├── smoke-ui.spec.ts   # фаза 1: smoke UI
    └── upload.spec.ts     # фаза 2: загрузка файла (happy path)
```

## Фикстуры Playwright

- `api` — клиент бэкенда; помнит всё, что создал, и удаляет это в teardown.
- `uploadFile(options)` — загружает файл через API и регистрирует авто-очистку.
  `{ fixture: 'malware', waitForProcessing: true }` — самый частый вызов.
- `uploadedFile` — готовый `clean.txt` в статусе `processed`.
- `appPage` — открытая страница приложения (сырой `Page`).
- `dashboard` — та же страница как page object `DashboardPage`: секции
  `files`/`alerts` со счётчиком, спиннером и таблицей, плюс `refresh()`,
  `mockLists()` и `delayLists()` для перехвата клиентских запросов.
  Для загрузки через UI: `openUploadModal()` / `uploadViaUi()`, доступ к строкам —
  `fileRow(title)` и `alertRow(fileTitle)`, ожидание воркера через «Обновить» —
  `refreshUntilStatus(row, 'processed')`.

Файл, загруженный через UI, известен тесту только по `title`: его id (для
проверок и teardown) достаётся через `api.waitForFileByTitle(title)` — этот
хелпер сразу регистрирует запись в авто-очистке.

## Изоляция

БД общая для всех тестов и прогонов. Изоляция держится на уникальном `title`
вида `[e2e] w<worker> <label> <timestamp>-<rand>` (`uniqueTitle`), поэтому
`fullyParallel` безопасен. Тесты, зависящие от общего счётчика или empty-state,
надо помечать `test.describe.serial` / выносить в отдельный проект — см. фазу 7.

## Фикстуры-файлы

Генерируются в `e2e/.tmp/fixtures/` (gitignored) идемпотентно — 11 МБ не
переписываются на каждом прогоне.

| Ключ | Файл | Что проверяет |
|---|---|---|
| `clean` | `clean.txt` | happy path, скан `clean` |
| `pdf` | `document.pdf` | маркеры `/Type /Page`, `approx_page_count` |
| `exe` | `malware.exe` | подозрительное расширение |
| `js` | `script.js` | подозрительное расширение `.js` |
| `empty` | `empty.txt` | 0 байт → 400 |
| `big` | `big-11mb.bin` | > 10 МБ → `suspicious` |
| `bigExe` | `big-malware.exe` | две причины в `scan_details` |
