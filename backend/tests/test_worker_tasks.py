import asyncio
from uuid import uuid4

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool
import pytest

from src.alerts.models import Alert
from src.core import db
from src.core.config import settings
from src.files.enums import ProcessingStatus
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
