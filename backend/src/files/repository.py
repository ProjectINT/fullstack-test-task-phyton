from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.files.models import StoredFile


async def list_files(session: AsyncSession, limit: int, offset: int) -> list[StoredFile]:
    result = await session.execute(
        select(StoredFile).order_by(StoredFile.created_at.desc()).limit(limit).offset(offset)
    )
    return list(result.scalars().all())


async def get(session: AsyncSession, file_id: str) -> StoredFile | None:
    return await session.get(StoredFile, file_id)


def add(session: AsyncSession, file_item: StoredFile) -> None:
    session.add(file_item)


async def delete(session: AsyncSession, file_item: StoredFile) -> None:
    await session.delete(file_item)
