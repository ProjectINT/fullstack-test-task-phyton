import asyncio
from uuid import uuid4

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool
import pytest

from src.alerts.enums import AlertLevel
from src.alerts.models import Alert
from src.core import db
from src.core.config import settings
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


def test_worker_pipeline_survives_fresh_loop_per_task(worker_db, storage_dir, monkeypatch):
    """Регрессия B3: задачи выполняются в независимых event loop'ах и не должны
    падать из-за соединений, привязанных к уже закрытому loop."""
    file_id = seed_file(storage_dir)

    delayed: list[str] = []
    monkeypatch.setattr(tasks.extract_file_metadata, "delay", lambda fid: delayed.append(f"extract:{fid}"))
    monkeypatch.setattr(tasks.send_file_alert, "delay", lambda fid: delayed.append(f"alert:{fid}"))

    # три вызова = три event loop'а, как у последовательных задач в одном процессе воркера
    tasks.scan_file_for_threats(file_id)
    tasks.extract_file_metadata(file_id)
    tasks.send_file_alert(file_id)

    assert delayed == [f"extract:{file_id}", f"alert:{file_id}"]

    async def load_result():
        async with db.worker_session() as session:
            file_item = await session.get(StoredFile, file_id)
            alerts = (await session.execute(select(Alert).where(Alert.file_id == file_id))).scalars().all()
            return file_item, alerts

    file_item, alerts = asyncio.run(load_result())
    assert file_item.processing_status == ProcessingStatus.PROCESSED
    assert file_item.metadata_json["line_count"] == 2
    assert len(alerts) == 1


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


def load_file_and_alerts(file_id: str) -> tuple[StoredFile | None, list[Alert]]:
    async def load():
        async with db.worker_session() as session:
            file_item = await session.get(StoredFile, file_id)
            alerts = (await session.execute(select(Alert).where(Alert.file_id == file_id))).scalars().all()
            return file_item, list(alerts)

    return asyncio.run(load())


def test_processing_status_committed_before_scan_result(worker_db, storage_dir, monkeypatch):
    """Регрессия B8: статус processing коммитится отдельной транзакцией до результата
    скана, поэтому виден другим соединениям, пока скан ещё идёт."""
    file_id = seed_file(storage_dir)

    committed: list[tuple[str | None, str | None]] = []
    real_commit = AsyncSession.commit

    async def commit_and_read_from_outside(self):
        await real_commit(self)
        engine = create_async_engine(worker_db, poolclass=NullPool)
        async with engine.connect() as conn:
            result = await conn.execute(
                select(StoredFile.processing_status, StoredFile.scan_status).where(StoredFile.id == file_id)
            )
            committed.append(tuple(result.one()))
        await engine.dispose()

    monkeypatch.setattr(AsyncSession, "commit", commit_and_read_from_outside)

    async def run_scan():
        async with db.worker_session() as session:
            await files_service.scan_file_for_threats(session, file_id)

    asyncio.run(run_scan())

    assert committed == [
        (ProcessingStatus.PROCESSING, None),
        (ProcessingStatus.PROCESSING, ScanStatus.CLEAN),
    ]


def test_pipeline_tasks_have_retry_config():
    """B9: у всех задач конвейера настроены авторетраи с ограничением попыток."""
    for task in (tasks.scan_file_for_threats, tasks.extract_file_metadata, tasks.send_file_alert):
        assert task.autoretry_for == (Exception,)
        assert task.max_retries == 3
        assert task.retry_backoff is True


def test_final_failure_marks_file_failed_and_creates_critical_alert(worker_db, storage_dir):
    """B9: после исчерпания ретраев on_failure переводит файл в failed и создаёт
    critical-алерт — файл не остаётся навсегда в processing."""
    file_id = seed_file(storage_dir)

    tasks.extract_file_metadata.on_failure(RuntimeError("boom"), "task-id", (file_id,), {}, None)

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

    tasks.scan_file_for_threats.on_failure(RuntimeError("boom"), "task-id", (missing_id,), {}, None)

    file_item, alerts = load_file_and_alerts(missing_id)
    assert file_item is None
    assert alerts == []
