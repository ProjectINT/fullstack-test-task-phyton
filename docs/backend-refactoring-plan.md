# План рефакторинга бэкенда

Аудит текущего кода: `src/app.py`, `src/service.py`, `src/models.py`, `src/schemas.py`, `src/tasks.py`.
Бизнес-логика (загрузка файла → скан на угрозы → извлечение метаданных → алерт) сохраняется как есть.

## 1. Найденные проблемы

### 1.1 Баги

| # | Проблема | Где | Последствие |
|---|----------|-----|-------------|
| B1 | Удаление файла, у которого есть алерты, падает с `IntegrityError` — FK `alerts.file_id → files.id` без `ON DELETE CASCADE`, а `delete_file` алерты не трогает | `service.py:83`, `models.py:42` | 500 на `DELETE /files/{id}` для любого обработанного файла (алерт создаётся для каждого файла) |
| B2 | В `delete_file` файл удаляется с диска **до** коммита в БД; при ошибке коммита (в т.ч. из-за B1) запись остаётся, а файла на диске уже нет | `service.py:88-92` | Рассинхронизация БД и стораджа |
| B3 | Кастомный event loop в Celery-воркере: `engine` создаётся на импорте, а loop пересоздаётся при закрытии (`run_in_worker_loop`). Соединения asyncpg из пула привязаны к старому loop → «attached to a different loop» | `tasks.py:13-23` | Периодические падения задач воркера |
| B4 | Весь файл читается в память: `await upload_file.read()` при загрузке и `stored_path.read_bytes()` при извлечении метаданных PDF | `service.py:46`, `tasks.py:79` | OOM / деградация на больших файлах |
| B5 | Блокирующий I/O в async-контексте: `write_bytes`, `read_text`, `unlink` внутри корутин блокируют event loop | `service.py:54`, `tasks.py:75` | Замирание всего API под нагрузкой |
| B6 | `size: Integer` — переполнение для файлов > 2 ГБ | `models.py:19` | Ошибка вставки |
| B7 | `tasks.py` читает `REDIS_URL`, а в `.env.dev` задан `CELERY_BROKER_URL` — работает только за счёт совпадения дефолта | `tasks.py:9` | Хрупкая конфигурация |
| B8 | `processing_status = "processing"` ставится, но коммитится одной транзакцией вместе с результатом скана — промежуточный статус никогда не виден | `tasks.py:32` | Мёртвый код / вводящий в заблуждение статус |
| B9 | Если таска метаданных упала/не выполнилась, файл навсегда остаётся в `processing`; ретраев и обработки ошибок в задачах нет | `tasks.py` | Зависшие файлы без алертов |

### 1.2 Архитектурные проблемы

- **Нет слоёв.** `service.py` — это одновременно конфиг (DB_URL из env), инфраструктура (engine, session_maker, сторадж) и бизнес-логика. Роутеры лежат в одном `app.py`.
- **HTTP-исключения в сервисном слое.** `HTTPException` бросается из `service.py` — бизнес-логика привязана к транспорту, её нельзя переиспользовать в Celery.
- **Два engine.** `service.py` и `tasks.py` создают отдельные engine; при этом API-процесс импортирует `tasks.py` и получает оба.
- **Сессия на каждый вызов функции**, а не на запрос — нет DI через `Depends`, нельзя объединить операции в одну транзакцию.
- **Статусы — magic strings** (`"uploaded"`, `"processing"`, `"suspicious"`, `"warning"`, …) разбросаны по коду без единого Enum.
- **Дублирование:** `download_file` в `app.py` повторяет логику `get_file_path` из `service.py` (который вообще не используется).
- **Цепочка задач захардкожена** через `.delay()` внутри тел задач — вместо Celery `chain`, шаги нельзя переиспользовать/тестировать по отдельности.
- **Нет пагинации** в `GET /files` и `GET /alerts`.
- **Нет ни одного теста.**
- Мелочи: `id` как `String(36)` вместо `UUID`, нет индекса на `alerts.file_id` и `files.created_at` (сортировка), `.delay()` в эндпоинте после ответа не защищён от недоступности Redis, alembic `env.py` импортирует `DB_URL` из сервисного слоя.

## 2. Целевая архитектура

```
backend/src/
├── main.py                  # создание FastAPI-приложения, подключение роутеров, CORS
├── core/
│   ├── config.py            # pydantic-settings: DB, Redis, storage, лимиты
│   ├── db.py                # engine, session_maker, get_session (DI)
│   └── exceptions.py        # доменные исключения (FileNotFound, EmptyFile...) + хендлеры → HTTP
├── files/
│   ├── router.py            # эндпоинты /files
│   ├── service.py           # бизнес-логика (без HTTP, принимает session)
│   ├── repository.py        # запросы к БД (StoredFile)
│   ├── storage.py           # файловый сторадж (async, потоковый)
│   ├── models.py            # StoredFile
│   ├── schemas.py           # FileItem, FileUpdate
│   └── enums.py             # ProcessingStatus, ScanStatus
├── alerts/
│   ├── router.py            # /alerts
│   ├── repository.py
│   ├── models.py            # Alert
│   ├── schemas.py
│   └── enums.py             # AlertLevel
└── worker/
    ├── celery_app.py        # конфиг Celery
    └── tasks.py             # тонкие обёртки над сервисами: scan → metadata → alert (chain)
```

Принципы:
- **router → service → repository/storage**; наружу из service — доменные исключения, в HTTP их превращает exception handler.
- **Одна точка создания engine** в `core/db.py`; API получает сессию через `Depends(get_session)`, воркер — через свой session-фабричный хелпер.
- **Конфиг только через pydantic-settings** (`DATABASE_URL`/составные поля, `CELERY_BROKER_URL`, `STORAGE_DIR`, `MAX_FILE_SIZE`), никаких `os.environ.get` по коду.
- **Enum'ы статусов** и уровней алертов вместо строк.

## 3. Шаги выполнения

### Шаг 1. Каркас
1. `core/config.py` (pydantic-settings, добавить зависимость `pydantic-settings`), `core/db.py`, `core/exceptions.py` + хендлеры.
2. Разнести код по пакетам `files/`, `alerts/`, `worker/` согласно схеме выше; `main.py` вместо `app.py`. Обновить `docker-compose.dev.yml` (команды uvicorn/celery) и `migrations/env.py` (брать URL из конфига).

### Шаг 2. Исправление багов
1. **B1/B2:** FK с `ondelete="CASCADE"` (+ индекс на `alerts.file_id`), новая alembic-миграция; в `delete_file` — сначала коммит удаления записи, затем удаление файла с диска.
2. **B3:** воркер переводится на честную схему: одна задача = `asyncio.run()` + engine с `NullPool` (или создание/dispose engine в рамках задачи). Просто и корректно для нашего профиля нагрузки.
3. **B4/B5:** потоковая запись загрузки чанками через `aiofiles` (+ зависимость), лимит размера из конфига; метаданные PDF считать чанками, файловые операции в воркере — тоже без загрузки в память.
4. **B6:** `size` → `BigInteger` (в ту же миграцию).
5. **B7:** брокер только из `CELERY_BROKER_URL` через конфиг.
6. **B8/B9:** статус `processing` коммитить отдельно до скана; задачам добавить `autoretry_for`/`max_retries` и перевод файла в `failed` + critical-алерт при окончательном фейле.

### Шаг 3. Качество API
1. Пагинация `limit/offset` для `GET /files` и `GET /alerts`.
2. Убрать дублирование download-логики (единый `storage.resolve(file)` в сервисе).
3. Enum'ы статусов в моделях и схемах ответов.

### Шаг 4. Оптимизация (доп. задание)
Кандидат на «неочевидную оптимизацию» — конвейер обработки:
- **Один проход вместо трёх задач с тремя сессиями/фетчами файла:** объединить scan + metadata в один шаг либо связать шаги через Celery `chain(scan.s(id), extract.s(), alert.s())`, передавая уже известные данные, а не перечитывая запись из БД в каждой задаче.
- **Не читать файл дважды:** размер, mime и расширение известны уже при загрузке; метаданные текстов/PDF считать одним потоковым проходом.
- Убрать лишние `session.refresh()` после коммита (при `expire_on_commit=False` нужен только для server_default-полей — получать их через `RETURNING`).

### Шаг 5. Тесты
1. `pytest` + `pytest-asyncio` + `httpx.AsyncClient`; юнит-тесты сервисов (скан-правила, метаданные) и интеграционные тесты CRUD-эндпоинтов.
2. Тест на удаление файла с алертами (регрессия B1).

## 4. Порядок и проверка

Шаги 1–2 — ядро (рефакторинг + баги), шаги 3–5 — по мере времени. После каждого шага:

```bash
docker compose -f docker-compose.dev.yml up --build
docker exec -it backend alembic upgrade head
# smoke: загрузка файла → статус processed → алерт создан → скачивание → удаление
```
