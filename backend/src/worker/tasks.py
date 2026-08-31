import asyncio
from collections.abc import Coroutine

from src.core.db import async_session_maker
from src.files import service as files_service
from src.worker.celery_app import celery_app

_worker_loop: asyncio.AbstractEventLoop | None = None


def run_in_worker_loop(coroutine: Coroutine):
    global _worker_loop
    if _worker_loop is None or _worker_loop.is_closed():
        _worker_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_worker_loop)
    return _worker_loop.run_until_complete(coroutine)


async def _scan_file_for_threats(file_id: str) -> bool:
    async with async_session_maker() as session:
        return await files_service.scan_file_for_threats(session, file_id)


async def _extract_file_metadata(file_id: str) -> bool:
    async with async_session_maker() as session:
        return await files_service.extract_file_metadata(session, file_id)


async def _send_file_alert(file_id: str) -> None:
    async with async_session_maker() as session:
        await files_service.send_file_alert(session, file_id)


@celery_app.task
def scan_file_for_threats(file_id: str) -> None:
    if run_in_worker_loop(_scan_file_for_threats(file_id)):
        extract_file_metadata.delay(file_id)


@celery_app.task
def extract_file_metadata(file_id: str) -> None:
    if run_in_worker_loop(_extract_file_metadata(file_id)):
        send_file_alert.delay(file_id)


@celery_app.task
def send_file_alert(file_id: str) -> None:
    run_in_worker_loop(_send_file_alert(file_id))
