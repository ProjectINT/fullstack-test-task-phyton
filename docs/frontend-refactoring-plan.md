# План рефакторинга фронтенда

Фронтенд — Next.js (App Router), один клиентский компонент `src/app/page.tsx` (~370 строк),
react-bootstrap. Ниже — найденные проблемы и пофазный план их устранения.

## 1. Найденные проблемы

### 1.1 Баги

1. **Хардкод `http://localhost:8000`** — URL бэкенда зашит в трёх местах (`loadData`,
   `handleSubmit`, ссылка «Скачать» в `page.tsx`). В Docker/проде фронт не увидит API;
   в `docker-compose.dev.yml` сервису `frontend` не передаётся ни одной env-переменной.
2. **Устаревший `selectedFile` после отмены модалки** — при закрытии модалки состояние
   `title`/`selectedFile` не сбрасывается. Модалка размонтируется, file-input при повторном
   открытии выглядит пустым, но в state остаётся старый `File` → сабмит отправит файл,
   которого пользователь не видит в форме.
3. **Ошибка формы не видна в модалке** — один общий `errorMessage` для загрузки списка и
   для формы. `Alert` рендерится на странице под backdrop'ом модалки: при ошибке валидации
   или ответа API пользователь в открытой модалке ничего не видит. Ошибка также не
   сбрасывается при закрытии/открытии модалки.
4. **Тексты ошибок API теряются** — при `!response.ok` показывается генерик «Не удалось
   загрузить файл», хотя FastAPI возвращает `detail` (валидация, размер файла и т.п.).
5. **Молчаливое усечение списков** — бэкенд отдаёт максимум `limit=100` записей
   (`src/core/pagination.py`), фронт не передаёт `limit/offset` и не имеет UI пагинации:
   всё после первых 100 файлов/алертов невидимо без каких-либо признаков этого.
6. **Вводящий в заблуждение бейдж «Проверка»** — цвет берётся из `requires_attention`,
   а текст из `scan_status`: файл со `scan_status = null` показывается как зелёный
   «pending», а `failed` тоже может быть зелёным. Цвет должен выводиться из самого
   `scan_status` (clean → success, suspicious → danger, failed → danger, null → secondary).
7. **Битая ссылка на favicon** — в `layout.tsx` указан `href="/public/favicon.ico"`:
   содержимое `public/` раздаётся от корня (`/favicon.ico`), плюс действует `basePath`.
   Правильно — положить `favicon.ico` в `src/app/` или объявить через `metadata.icons`.
8. **`basePath: '/test'` в `next.config.ts`** — приложение доступно только по
   `localhost:3000/test`; выглядит как отладочный остаток. Убрать (или осознанно
   задокументировать).
9. **Сломанная типизация** — в `devDependencies` нет `@types/react` и `@types/react-dom`,
   `strict: false` в `tsconfig.json`: TSX-типизация фактически не работает.
10. **Нет автообновления статусов** — обработка файла асинхронная (Celery): после загрузки
    файл навсегда висит в «processing», пока пользователь вручную не нажмёт «Обновить».

### 1.2 Архитектурные проблемы

1. Весь UI, типы, форматтеры и работа с API — в одном компоненте `page.tsx`.
2. Нет слоя API-клиента: `fetch` с дублированием обработки ошибок разбросан по коду.
3. Типы `FileItem.processing_status`, `scan_status`, `AlertItem.level` — просто `string`,
   хотя на бэкенде это enum'ы (`ProcessingStatus`, `ScanStatus`, `AlertLevel`).
4. Один `isLoading` на обе таблицы; при «Обновить» таблицы полностью заменяются спиннером.
   Повторные клики по «Обновить» не отменяют предыдущие запросы (возможна гонка ответов).
5. `package.json`: `next: "latest"` (невоспроизводимая сборка, Next 15 требует React 19 при
   `react: ^18.2`), нет скриптов `start` и `lint`, нет ESLint.
6. `layout.tsx`: лишний `async` у `RootLayout`, `generateMetadata` вместо статического
   `export const metadata`, ручной `<head>`, клиентский `Container` в серверном layout'е.
7. Бэкенд умеет `DELETE /files/{id}` и `PATCH /files/{id}` (переименование), UI для этого
   нет; алерты не связаны ссылкой с файлами.

## 2. Целевая структура

```
frontend/src/
  app/
    layout.tsx          # серверный, статический metadata, favicon через app/
    page.tsx            # тонкая страница: собирает компоненты
  lib/
    api.ts              # apiFetch + getFiles/getAlerts/uploadFile/deleteFile/renameFile
    types.ts            # FileItem, AlertItem, union-типы статусов = enum'ам бэкенда
    format.ts           # formatDate, formatSize
  components/
    FilesTable.tsx
    AlertsTable.tsx
    UploadModal.tsx
    StatusBadge.tsx     # маппинг статусов → variant в одном месте
  hooks/
    usePagedResource.ts # загрузка + пагинация + ошибки (общий для files/alerts)
```

## 3. Шаги выполнения

### Фаза 0. Тулинг и типизация

- Добавить `@types/react`, `@types/react-dom`, ESLint (`eslint-config-next`).
- `tsconfig.json`: `strict: true`, плагин `next`, alias `@/*`.
- `package.json`: закрепить версии (`next` без `latest`), добавить `start` и `lint`.
- Ввести `NEXT_PUBLIC_API_URL` (`.env.example`, прокинуть в `docker-compose.dev.yml`
  и `Dockerfile`), локальный дефолт `http://localhost:8000`.

### Фаза 1. Багфиксы (минимальные точечные правки)

- Заменить все хардкоды URL на `NEXT_PUBLIC_API_URL` (баг 1.1.1).
- Сбрасывать `title`, `selectedFile` и ошибку формы при закрытии модалки (1.1.2, 1.1.3).
- Разделить `errorMessage` на ошибку страницы и ошибку формы; ошибку формы рендерить
  внутри `Modal.Body`; извлекать `detail` из ответа API (1.1.3, 1.1.4).
- Исправить маппинг цвета бейджа «Проверка» на основе `scan_status` (1.1.6).
- Убрать `basePath: '/test'`; починить favicon через `src/app/favicon.ico` (1.1.7, 1.1.8).
- Упростить `layout.tsx`: статический `metadata`, без `async`, без ручного `<head>`.

### Фаза 2. Архитектура

- Вынести типы в `lib/types.ts`, статусы — union-типами в соответствии с enum'ами бэкенда.
- Создать `lib/api.ts` с общим `apiFetch` (базовый URL, обработка `detail`, JSON) и
  функциями `getFiles/getAlerts/uploadFile`.
- Вынести `formatDate`/`formatSize` в `lib/format.ts`, маппинг статусов — в `StatusBadge`.
- Разбить `page.tsx` на `FilesTable`, `AlertsTable`, `UploadModal`.
- Хук `usePagedResource`: состояние загрузки/ошибки на каждый ресурс отдельно,
  `AbortController` против гонки запросов, спиннер не заменяет таблицу при refetch.

### Фаза 3. UX и полнота API (доп. задание)

- Пагинация UI: передавать `limit/offset`, кнопки «вперёд/назад» под таблицами (1.1.5).
- Поллинг: пока есть файлы в статусе `uploaded`/`processing` — автообновление раз в
  3–5 сек, остановка, когда все статусы терминальные (1.1.10).
- Кнопки «Удалить» (с подтверждением) и «Переименовать» — бэкенд уже это умеет.
- В таблице алертов `file_id` — ссылка/подсветка соответствующего файла.

### Фаза 4. Проверка

- `npm run lint` и `npm run build` без ошибок при `strict: true`.
- Smoke через `docker-compose.dev.yml`: открыть список → загрузить файл → ошибка формы
  видна в модалке → статус дошёл до `processed` поллингом → скачать → удалить →
  алерты отображаются, пагинация листает.
- Проверить, что фронт в Docker ходит на API по `NEXT_PUBLIC_API_URL`, а CORS в
  `backend/src/main.py` разрешает нужный origin.

## 4. Порядок и риски

Фазы независимы по коммитам: 0 → 1 можно вливать сразу (чистые багфиксы), 2 — рефакторинг
без изменения поведения, 3 — новая функциональность. Отдельно согласовать удаление
`basePath: '/test'` — если он нужен для деплоя за reverse-proxy, вместо удаления вынести
в env и учесть его в ссылках на скачивание.
