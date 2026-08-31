from pathlib import Path

from src.core.config import settings
from src.core.exceptions import StoredFileNotFound

settings.storage_dir.mkdir(parents=True, exist_ok=True)


def path_for(stored_name: str) -> Path:
    return settings.storage_dir / stored_name


def resolve(stored_name: str) -> Path:
    path = path_for(stored_name)
    if not path.exists():
        raise StoredFileNotFound
    return path


def save(stored_name: str, content: bytes) -> Path:
    path = path_for(stored_name)
    path.write_bytes(content)
    return path


def delete(stored_name: str) -> None:
    path = path_for(stored_name)
    if path.exists():
        path.unlink()
