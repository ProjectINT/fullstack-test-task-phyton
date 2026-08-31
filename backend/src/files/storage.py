from collections.abc import AsyncIterator
from pathlib import Path

import aiofiles
import aiofiles.os

from src.core.config import settings
from src.core.exceptions import StoredFileNotFound

CHUNK_SIZE = 1024 * 1024

settings.storage_dir.mkdir(parents=True, exist_ok=True)


def path_for(stored_name: str) -> Path:
    return settings.storage_dir / stored_name


async def exists(stored_name: str) -> bool:
    return await aiofiles.os.path.exists(path_for(stored_name))


async def resolve(stored_name: str) -> Path:
    path = path_for(stored_name)
    if not await aiofiles.os.path.exists(path):
        raise StoredFileNotFound
    return path


async def save(stored_name: str, chunks: AsyncIterator[bytes]) -> int:
    path = path_for(stored_name)
    size = 0
    async with aiofiles.open(path, "wb") as stored:
        async for chunk in chunks:
            size += len(chunk)
            await stored.write(chunk)
    return size


async def iter_chunks(stored_name: str) -> AsyncIterator[bytes]:
    async with aiofiles.open(path_for(stored_name), "rb") as stored:
        while chunk := await stored.read(CHUNK_SIZE):
            yield chunk


async def delete(stored_name: str) -> None:
    path = path_for(stored_name)
    if await aiofiles.os.path.exists(path):
        await aiofiles.os.remove(path)
