import pytest
from sqlalchemy import select

from src.alerts.models import Alert
from src.files import repository, service


async def upload_sample(client, title: str = "sample") -> dict:
    response = await client.post(
        "/files",
        data={"title": title},
        files={"file": ("sample.txt", b"hello\nworld\n", "text/plain")},
    )
    assert response.status_code == 201
    return response.json()


async def test_delete_file_with_alerts_cascades(client, session, storage_dir):
    """Регрессия B1: удаление обработанного файла (с алертами) не должно падать."""
    uploaded = await upload_sample(client)
    file_id = uploaded["id"]

    # прогоняем пайплайн воркера, чтобы у файла появился алерт
    assert await service.scan_file_for_threats(session, file_id)
    assert await service.extract_file_metadata(session, file_id)
    await service.send_file_alert(session, file_id)

    alerts = (await session.execute(select(Alert).where(Alert.file_id == file_id))).scalars().all()
    assert alerts, "pipeline must have created an alert"
    await session.rollback()  # отпускаем read-транзакцию, чтобы не блокировать DELETE

    response = await client.delete(f"/files/{file_id}")
    assert response.status_code == 204

    assert (await client.get(f"/files/{file_id}")).status_code == 404
    remaining_alerts = (await session.execute(select(Alert))).scalars().all()
    assert remaining_alerts == [], "alerts must be removed by ON DELETE CASCADE"
    assert list(storage_dir.iterdir()) == [], "stored file must be removed from disk"


async def test_delete_keeps_stored_file_when_commit_fails(client, session, storage_dir, monkeypatch):
    """Регрессия B2: если коммит удаления упал, файл на диске должен остаться."""
    uploaded = await upload_sample(client)
    file_id = uploaded["id"]
    stored_files = list(storage_dir.iterdir())
    assert len(stored_files) == 1

    async def failing_commit():
        raise RuntimeError("db commit failed")

    monkeypatch.setattr(session, "commit", failing_commit)

    with pytest.raises(RuntimeError):
        await service.delete_file(session, file_id)
    await session.rollback()

    assert list(storage_dir.iterdir()) == stored_files, "stored file must survive a failed commit"
    assert await repository.get(session, file_id) is not None, "db record must survive a failed commit"
