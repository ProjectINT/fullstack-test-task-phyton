import uuid

from sqlalchemy import select
from sqlalchemy.dialects import postgresql

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
