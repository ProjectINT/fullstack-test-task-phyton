import asyncio

from src.core.db import worker_session
from src.files import service as files_service
from src.worker.celery_app import celery_app


async def _scan_file_for_threats(file_id: str) -> bool:
    async with worker_session() as session:
        return await files_service.scan_file_for_threats(session, file_id)


async def _extract_file_metadata(file_id: str) -> bool:
    async with worker_session() as session:
        return await files_service.extract_file_metadata(session, file_id)


async def _send_file_alert(file_id: str) -> None:
    async with worker_session() as session:
        await files_service.send_file_alert(session, file_id)


@celery_app.task
def scan_file_for_threats(file_id: str) -> None:
    if asyncio.run(_scan_file_for_threats(file_id)):
        extract_file_metadata.delay(file_id)


@celery_app.task
def extract_file_metadata(file_id: str) -> None:
    if asyncio.run(_extract_file_metadata(file_id)):
        send_file_alert.delay(file_id)


@celery_app.task
def send_file_alert(file_id: str) -> None:
    asyncio.run(_send_file_alert(file_id))
