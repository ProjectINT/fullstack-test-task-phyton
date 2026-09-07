import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from src.alerts.enums import AlertLevel
from src.alerts.models import Alert
from src.core import db
from src.core.config import settings
from src.files import repository
from src.files import service as files_service
from src.files.enums import ProcessingStatus, ScanStatus
from src.files.models import StoredFile
from src.worker import tasks


@pytest.fixture
def worker_db(tmp_path, monkeypatch) -> str:
    """Отдельная sqlite-БД, на которую смотрит worker_session через settings.database_url."""
    url = f"sqlite+aiosqlite:///{tmp_path}/worker.db"
    monkeypatch.setattr(type(settings), "database_url", url)

    async def create_schema():
        engine = create_async_engine(url)
        async with engine.begin() as conn:
            await conn.run_sync(db.Base.metadata.create_all)
        await engine.dispose()

    asyncio.run(create_schema())
    return url


def seed_file(storage_dir) -> str:
    content = b"hello\nworld\n"
    file_id = str(uuid4())
    stored_name = f"{file_id}.txt"
    (storage_dir / stored_name).write_bytes(content)

    async def seed():
        async with db.worker_session() as session:
            session.add(
                StoredFile(
                    id=file_id,
                    title="sample",
                    original_name="sample.txt",
                    stored_name=stored_name,
                    mime_type="text/plain",
                    size=len(content),
                    processing_status=ProcessingStatus.UPLOADED,
                )
            )
            await session.commit()

    asyncio.run(seed())
    return file_id


def load_file_and_alerts(file_id: str) -> tuple[StoredFile | None, list[Alert]]:
    async def load():
        async with db.worker_session() as session:
            file_item = await session.get(StoredFile, file_id)
            alerts = (
                (await session.execute(select(Alert).where(Alert.file_id == file_id)))
                .scalars()
                .all()
            )
            return file_item, list(alerts)

    return asyncio.run(load())


def test_worker_pipeline_survives_fresh_loop_per_task(worker_db, storage_dir):
    """Регрессия B3: задачи выполняются в независимых event loop'ах и не должны
    падать из-за соединений, привязанных к уже закрытому loop."""
    first_id = seed_file(storage_dir)
    second_id = seed_file(storage_dir)

    # два вызова = два event loop'а, как у последовательных задач в одном процессе воркера
    tasks.process_file(first_id)
    tasks.process_file(second_id)

    for file_id in (first_id, second_id):
        file_item, alerts = load_file_and_alerts(file_id)
        assert file_item.processing_status == ProcessingStatus.PROCESSED
        assert file_item.metadata_json["line_count"] == 2
        assert len(alerts) == 1
        assert alerts[0].level == AlertLevel.INFO


def test_worker_session_uses_fresh_disposable_engine(worker_db, monkeypatch):
    """Регрессия B3: у каждой задачи свой engine без пула, освобождаемый по завершении, —
    ни одно соединение не переживает свой event loop."""
    created, disposed = [], []
    real_create_async_engine = db.create_async_engine
    real_dispose = AsyncEngine.dispose

    def spying_create_async_engine(*args, **kwargs):
        engine = real_create_async_engine(*args, **kwargs)
        created.append(engine)
        return engine

    async def dispose_and_record(self, *args, **kwargs):
        disposed.append(self)
        await real_dispose(self, *args, **kwargs)

    monkeypatch.setattr(db, "create_async_engine", spying_create_async_engine)
    monkeypatch.setattr(AsyncEngine, "dispose", dispose_and_record)

    async def run_once():
        async with db.worker_session() as session:
            await session.execute(text("select 1"))

    asyncio.run(run_once())
    asyncio.run(run_once())

    assert len(created) == 2
    assert created[0] is not created[1], "каждый запуск должен получать собственный engine"
    assert disposed == created, "engine должен освобождаться до закрытия loop"
    for engine in created:
        assert isinstance(engine.sync_engine.pool, NullPool)


def test_pipeline_runs_in_one_engine_session_and_fetch(worker_db, storage_dir, monkeypatch):
    """Шаг 4: весь конвейер — одна задача с одним engine/сессией и одной выборкой
    записи вместо трёх задач с тремя engine/сессиями/фетчами."""
    file_id = seed_file(storage_dir)

    created_engines: list[AsyncEngine] = []
    real_create_async_engine = db.create_async_engine

    def spying_create_async_engine(*args, **kwargs):
        engine = real_create_async_engine(*args, **kwargs)
        created_engines.append(engine)
        return engine

    fetched: list[str] = []
    real_get = repository.get

    async def counting_get(session, fid):
        fetched.append(fid)
        return await real_get(session, fid)

    monkeypatch.setattr(db, "create_async_engine", spying_create_async_engine)
    monkeypatch.setattr(files_service.repository, "get", counting_get)

    tasks.process_file(file_id)

    assert len(created_engines) == 1, "конвейер должен обходиться одним engine"
    assert fetched == [file_id], "запись должна выбираться из БД один раз"
    file_item, alerts = load_file_and_alerts(file_id)
    assert file_item.processing_status == ProcessingStatus.PROCESSED
    assert len(alerts) == 1


def test_processing_status_committed_before_scan_result(worker_db, storage_dir, monkeypatch):
    """Регрессия B8: статус processing коммитится отдельной транзакцией до результата
    обработки, поэтому виден другим соединениям, пока обработка ещё идёт."""
    file_id = seed_file(storage_dir)

    committed: list[tuple[str | None, str | None]] = []
    real_commit = AsyncSession.commit

    async def commit_and_read_from_outside(self):
        await real_commit(self)
        engine = create_async_engine(worker_db, poolclass=NullPool)
        async with engine.connect() as conn:
            result = await conn.execute(
                select(StoredFile.processing_status, StoredFile.scan_status).where(
                    StoredFile.id == file_id
                )
            )
            committed.append(tuple(result.one()))
        await engine.dispose()

    monkeypatch.setattr(AsyncSession, "commit", commit_and_read_from_outside)

    async def run_pipeline():
        async with db.worker_session() as session:
            await files_service.process_file(session, file_id)

    asyncio.run(run_pipeline())

    assert committed == [
        (ProcessingStatus.PROCESSING, None),
        (ProcessingStatus.PROCESSED, ScanStatus.CLEAN),
    ]


def test_pipeline_task_has_retry_config():
    """B9: у задачи конвейера настроены авторетраи с ограничением попыток."""
    assert tasks.process_file.autoretry_for == (Exception,)
    assert tasks.process_file.max_retries == 3
    assert tasks.process_file.retry_backoff is True


def test_final_failure_marks_file_failed_and_creates_critical_alert(worker_db, storage_dir):
    """B9: после исчерпания ретраев on_failure переводит файл в failed и создаёт
    critical-алерт — файл не остаётся навсегда в processing."""
    file_id = seed_file(storage_dir)

    tasks.process_file.on_failure(RuntimeError("boom"), "task-id", (file_id,), {}, None)

    file_item, alerts = load_file_and_alerts(file_id)
    assert file_item.processing_status == ProcessingStatus.FAILED
    assert file_item.scan_status == ScanStatus.FAILED
    assert "boom" in file_item.scan_details
    assert len(alerts) == 1
    assert alerts[0].level == AlertLevel.CRITICAL
    assert "boom" in alerts[0].message


def test_final_failure_for_missing_file_is_noop(worker_db):
    """on_failure не падает и ничего не создаёт, если файл уже удалён."""
    missing_id = str(uuid4())

    tasks.process_file.on_failure(RuntimeError("boom"), "task-id", (missing_id,), {}, None)

    file_item, alerts = load_file_and_alerts(missing_id)
    assert file_item is None
    assert alerts == []
