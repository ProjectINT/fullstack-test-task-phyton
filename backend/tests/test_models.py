import uuid

from sqlalchemy import select
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession

from src.files import service
from src.files.models import StoredFile

FIVE_GIB = 5 * 1024**3


def test_size_column_is_bigint_in_postgres():
    """Регрессия B6: Integer переполняется на файлах > 2 ГБ, колонка должна быть BIGINT."""
    column_type = StoredFile.__table__.c.size.type.compile(postgresql.dialect())
    assert column_type == "BIGINT"


async def test_size_over_2gb_roundtrips(session):
    """Регрессия B6: запись с size > 2**31 должна вставляться и читаться без переполнения."""
    file_id = str(uuid.uuid4())
    session.add(
        StoredFile(
            id=file_id,
            title="big",
            original_name="big.bin",
            stored_name=f"{file_id}.bin",
            mime_type="application/octet-stream",
            size=FIVE_GIB,
        )
    )
    await session.commit()

    stored = (
        await session.execute(select(StoredFile).where(StoredFile.id == file_id))
    ).scalar_one()
    assert stored.size == FIVE_GIB


class SmallUpload:
    filename = "sample.txt"
    content_type = "text/plain"
    _pos = 0

    async def read(self, size: int = -1) -> bytes:
        chunk = b"hello\n"[self._pos :]
        self._pos += len(chunk)
        return chunk


async def test_server_defaults_populated_without_refresh(session, storage_dir, monkeypatch):
    """Шаг 4: server_default-поля приходят через eager_defaults (RETURNING) —
    session.refresh после коммита не вызывается ни при создании, ни при обновлении."""

    async def forbidden_refresh(self, *args, **kwargs):
        raise AssertionError("session.refresh must not be called")

    monkeypatch.setattr(AsyncSession, "refresh", forbidden_refresh)

    file_item = await service.create_file(session, title="sample", upload_file=SmallUpload())
    assert file_item.created_at is not None
    assert file_item.updated_at is not None

    updated = await service.update_file(session, file_item.id, title="renamed")
    assert updated.title == "renamed"
    assert updated.updated_at is not None
