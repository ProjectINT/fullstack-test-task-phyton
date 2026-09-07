"""Шаг 3: пагинация limit/offset и enum'ы статусов в моделях/схемах."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from src.alerts.enums import AlertLevel
from src.alerts.models import Alert
from src.files.enums import ProcessingStatus, ScanStatus
from src.files.models import StoredFile

pytestmark = pytest.mark.asyncio

BASE_TIME = datetime(2026, 1, 1, tzinfo=UTC)


def make_file(index: int) -> StoredFile:
    return StoredFile(
        id=f"00000000-0000-0000-0000-{index:012d}",
        title=f"file {index}",
        original_name=f"file{index}.txt",
        stored_name=f"file{index}.txt",
        mime_type="text/plain",
        size=1,
        processing_status=ProcessingStatus.UPLOADED,
        created_at=BASE_TIME + timedelta(minutes=index),
        updated_at=BASE_TIME + timedelta(minutes=index),
    )


async def seed_files(session, count: int) -> list[StoredFile]:
    files = [make_file(i) for i in range(count)]
    session.add_all(files)
    await session.commit()
    return files


async def test_files_pagination_limit_offset(client, session):
    files = await seed_files(session, 5)

    response = await client.get("/files", params={"limit": 2, "offset": 1})

    assert response.status_code == 200
    # Сортировка по created_at desc: offset=1 пропускает самый свежий файл
    assert [item["id"] for item in response.json()] == [files[3].id, files[2].id]


async def test_files_listed_newest_first(client, session):
    files = await seed_files(session, 3)

    response = await client.get("/files")

    assert [item["id"] for item in response.json()] == [files[2].id, files[1].id, files[0].id]


async def test_files_pagination_defaults_return_everything_small(client, session):
    await seed_files(session, 3)

    response = await client.get("/files")

    assert response.status_code == 200
    assert len(response.json()) == 3


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 1001}, {"offset": -1}])
async def test_files_pagination_validates_bounds(client, params):
    response = await client.get("/files", params=params)
    assert response.status_code == 422


async def test_alerts_pagination_limit_offset(client, session):
    files = await seed_files(session, 1)
    session.add_all(
        Alert(
            file_id=files[0].id,
            level=AlertLevel.INFO,
            message=f"alert {i}",
            created_at=BASE_TIME + timedelta(minutes=i),
        )
        for i in range(4)
    )
    await session.commit()

    response = await client.get("/alerts", params={"limit": 2, "offset": 1})

    assert response.status_code == 200
    assert [item["message"] for item in response.json()] == ["alert 2", "alert 1"]


async def test_enum_values_stored_as_values_not_names(session):
    """Регрессия: SAEnum без values_callable пишет в БД имена членов ("UPLOADED")."""
    file_item = make_file(0)
    file_item.scan_status = ScanStatus.CLEAN
    session.add(file_item)
    await session.commit()
    session.add(Alert(file_id=file_item.id, level=AlertLevel.WARNING, message="check"))
    await session.commit()

    raw = (await session.execute(text("SELECT processing_status, scan_status FROM files"))).one()
    assert raw == ("uploaded", "clean")
    raw_level = (await session.execute(text("SELECT level FROM alerts"))).scalar_one()
    assert raw_level == "warning"


async def test_models_return_enum_instances(session):
    files = await seed_files(session, 1)
    session.expunge_all()

    file_item = await session.get(StoredFile, files[0].id)
    assert isinstance(file_item.processing_status, ProcessingStatus)


async def test_api_serializes_enum_values(client, session):
    files = await seed_files(session, 1)
    session.add(Alert(file_id=files[0].id, level=AlertLevel.CRITICAL, message="boom"))
    await session.commit()

    files_response = await client.get("/files")
    alerts_response = await client.get("/alerts")

    assert files_response.json()[0]["processing_status"] == "uploaded"
    assert alerts_response.json()[0]["level"] == "critical"
