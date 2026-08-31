import asyncio
import logging

from src.core.db import worker_session
from src.files import service as files_service
from src.worker.celery_app import celery_app

logger = logging.getLogger(__name__)


async def _process_file(file_id: str) -> None:
    async with worker_session() as session:
        await files_service.process_file(session, file_id)


async def _mark_file_failed(file_id: str, reason: str) -> None:
    async with worker_session() as session:
        await files_service.mark_file_failed(session, file_id, reason)


class FileProcessingTask(celery_app.Task):
    """B9: транзиентные ошибки ретраятся с бэкоффом; после исчерпания ретраев
    файл переводится в failed и создаётся critical-алерт."""

    autoretry_for = (Exception,)
    max_retries = 3
    retry_backoff = True

    def on_failure(self, exc, task_id, args, kwargs, einfo) -> None:
        file_id = args[0] if args else kwargs.get("file_id")
        if not file_id:
            return
        try:
            asyncio.run(_mark_file_failed(file_id, f"{self.name} failed: {exc}"))
        except Exception:
            logger.exception("could not mark file %s as failed after task %s", file_id, self.name)


@celery_app.task(base=FileProcessingTask)
def process_file(file_id: str) -> None:
    asyncio.run(_process_file(file_id))
