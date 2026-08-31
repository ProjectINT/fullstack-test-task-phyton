from src.core.config import Settings, settings
from src.worker.celery_app import celery_app


def test_celery_broker_url_read_from_env(monkeypatch):
    """CELERY_BROKER_URL из окружения попадает в конфиг (регрессия B7)."""
    monkeypatch.setenv("CELERY_BROKER_URL", "redis://custom-host:6380/5")
    assert Settings().celery_broker_url == "redis://custom-host:6380/5"


def test_legacy_redis_url_is_ignored(monkeypatch):
    """Старый REDIS_URL никак не влияет на брокер — только CELERY_BROKER_URL."""
    monkeypatch.setenv("REDIS_URL", "redis://wrong-host:1111/9")
    monkeypatch.setenv("CELERY_BROKER_URL", "redis://right-host:6379/0")
    assert Settings().celery_broker_url == "redis://right-host:6379/0"


def test_celery_app_broker_comes_from_config():
    """Celery берёт broker и backend из settings.celery_broker_url, а не из env напрямую."""
    assert celery_app.conf.broker_url == settings.celery_broker_url
    assert celery_app.conf.result_backend == settings.celery_broker_url
