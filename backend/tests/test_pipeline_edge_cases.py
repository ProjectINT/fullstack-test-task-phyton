"""Краевые случаи конвейера обработки: пропавший файл, ретраи, усечение причин."""

from uuid import uuid4

from sqlalchemy import select

from src.alerts.enums import AlertLevel
from src.alerts.models import Alert
from src.files import repository, service
from src.files.enums import ProcessingStatus, ScanStatus
from src.files.models import StoredFile


async def seed_stored_file(session, storage_dir, content: bytes = b"hello\nworld\n") -> str:
    file_id = str(uuid4())
    stored_name = f"{file_id}.txt"
    (storage_dir / stored_name).write_bytes(content)
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
    return file_id


async def load_alerts(session, file_id: str) -> list[Alert]:
    return list((await session.execute(select(Alert).where(Alert.file_id == file_id))).scalars().all())


async def test_process_file_with_missing_stored_file_marks_failed(session, storage_dir):
    """Если записи в БД соответствует пропавший с диска файл, конвейер помечает его
    failed с понятной причиной, а не падает и не оставляет processing."""
    file_id = await seed_stored_file(session, storage_dir)
    (storage_dir / f"{file_id}.txt").unlink()

    await service.process_file(session, file_id)

    file_item = await repository.get(session, file_id)
    assert file_item.processing_status == ProcessingStatus.FAILED
    assert file_item.scan_status == ScanStatus.FAILED
    assert file_item.scan_details == "stored file not found during processing"
    assert await load_alerts(session, file_id) == []


async def test_process_file_with_unknown_id_is_noop(session):
    """Ретрай задачи после удаления файла не должен падать и создавать записи."""
    await service.process_file(session, str(uuid4()))

    assert await repository.list_files(session, limit=100, offset=0) == []
    assert list((await session.execute(select(Alert))).scalars().all()) == []


async def test_process_file_rerun_does_not_duplicate_alerts(session, storage_dir):
    """Идемпотентность ретрая: результат скана, метаданные и алерт коммитятся одной
    транзакцией, поэтому повторный запуск для уже обработанного файла (например,
    ретрай после потери ack брокером) не должен плодить дубликаты алертов."""
    file_id = await seed_stored_file(session, storage_dir)

    await service.process_file(session, file_id)
    await service.process_file(session, file_id)

    file_item = await repository.get(session, file_id)
    assert file_item.processing_status == ProcessingStatus.PROCESSED
    alerts = await load_alerts(session, file_id)
    assert len(alerts) == 1


async def test_mark_file_failed_truncates_long_reason(session, storage_dir):
    """Причина фейла длиннее 500 символов обрезается под String(500), вставка не падает."""
    file_id = await seed_stored_file(session, storage_dir)
    reason = "x" * 600

    await service.mark_file_failed(session, file_id, reason)

    file_item = await repository.get(session, file_id)
    assert len(file_item.scan_details) == 500
    alerts = await load_alerts(session, file_id)
    assert len(alerts) == 1
    assert alerts[0].level == AlertLevel.CRITICAL
    assert len(alerts[0].message) == 500
    assert alerts[0].message.startswith("File processing failed: ")


async def test_mark_file_failed_keeps_existing_scan_status(session, storage_dir):
    """Если скан уже успел отработать, его результат не затирается статусом failed."""
    file_id = await seed_stored_file(session, storage_dir)
    file_item = await repository.get(session, file_id)
    file_item.scan_status = ScanStatus.SUSPICIOUS
    await session.commit()

    await service.mark_file_failed(session, file_id, "metadata step crashed")

    file_item = await repository.get(session, file_id)
    assert file_item.processing_status == ProcessingStatus.FAILED
    assert file_item.scan_status == ScanStatus.SUSPICIOUS
    assert file_item.scan_details == "metadata step crashed"
