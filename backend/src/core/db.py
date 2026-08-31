from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from src.core.config import settings


class Base(DeclarativeBase):
    pass


engine = create_async_engine(settings.database_url)
async_session_maker = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with async_session_maker() as session:
        yield session


@asynccontextmanager
async def worker_session() -> AsyncGenerator[AsyncSession]:
    """Сессия для Celery-задачи.

    Каждая задача выполняется в собственном event loop (asyncio.run), поэтому
    соединения нельзя переиспользовать между задачами: engine создаётся заново,
    без пула, и освобождается по завершении задачи.
    """
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            yield session
    finally:
        await engine.dispose()
