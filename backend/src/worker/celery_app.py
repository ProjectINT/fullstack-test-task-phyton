from celery import Celery

from src.core.config import settings

celery_app = Celery(
    "file_tasks",
    broker=settings.celery_broker_url,
    backend=settings.celery_broker_url,
    include=["src.worker.tasks"],
)
