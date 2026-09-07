from uuid import uuid4

import pytest

from src.core.config import settings
from src.core.exceptions import FileTooLarge
from src.files import repository, service, storage
from src.files.enums import ProcessingStatus
from src.files.models import StoredFile


class ChunkRecordingUpload:
    """Минимальный async-дублёр UploadFile: отдаёт контент кусками и записывает размеры чтений."""

    def __init__(self, filename: str, content: bytes, content_type: str = "text/plain"):
        self.filename = filename
        self.content_type = content_type
        self._content = content
        self._pos = 0
        self.read_sizes: list[int] = []

    async def read(self, size: int = -1) -> bytes:
        self.read_sizes.append(size)
        if size < 0:
            size = len(self._content) - self._pos
        chunk = self._content[self._pos : self._pos + size]
        self._pos += len(chunk)
        return chunk


async def seed_stored_file(
    session, storage_dir, content: bytes, mime_type: str, suffix: str
) -> str:
    file_id = str(uuid4())
    stored_name = f"{file_id}{suffix}"
    (storage_dir / stored_name).write_bytes(content)
    session.add(
        StoredFile(
            id=file_id,
            title="sample",
            original_name=f"sample{suffix}",
            stored_name=stored_name,
            mime_type=mime_type,
            size=len(content),
            processing_status=ProcessingStatus.UPLOADED,
        )
    )
    await session.commit()
    return file_id


async def test_upload_is_read_in_chunks_not_whole(session, storage_dir, monkeypatch):
    """Регрессия B4: загрузка не должна читать весь файл в память одним read()."""
    monkeypatch.setattr(storage, "CHUNK_SIZE", 4)
    content = b"hello world, streaming upload!"
    upload = ChunkRecordingUpload("sample.txt", content)

    file_item = await service.create_file(session, title="sample", upload_file=upload)

    assert all(size == 4 for size in upload.read_sizes), (
        "файл должен читаться только чанками CHUNK_SIZE"
    )
    assert file_item.size == len(content)
    assert storage.path_for(file_item.stored_name).read_bytes() == content


async def test_upload_over_limit_returns_413_and_cleans_partial_file(
    client, storage_dir, monkeypatch
):
    """Регрессия B4: лимит размера берётся из конфига, недописанный файл убирается с диска."""
    monkeypatch.setattr(settings, "max_file_size", 10)

    response = await client.post(
        "/files",
        data={"title": "big"},
        files={"file": ("big.bin", b"x" * 11, "application/octet-stream")},
    )

    assert response.status_code == 413
    assert list(storage_dir.iterdir()) == [], "частично записанный файл должен быть удалён"


async def test_upload_over_limit_does_not_create_db_record(session, storage_dir, monkeypatch):
    monkeypatch.setattr(settings, "max_file_size", 10)
    monkeypatch.setattr(storage, "CHUNK_SIZE", 4)
    upload = ChunkRecordingUpload("big.bin", b"x" * 11, "application/octet-stream")

    with pytest.raises(FileTooLarge):
        await service.create_file(session, title="big", upload_file=upload)

    assert await repository.list_files(session, limit=100, offset=0) == []
    assert list(storage_dir.iterdir()) == []


async def test_upload_empty_file_returns_400_and_leaves_nothing(client, storage_dir):
    response = await client.post(
        "/files",
        data={"title": "empty"},
        files={"file": ("empty.txt", b"", "text/plain")},
    )

    assert response.status_code == 400
    assert list(storage_dir.iterdir()) == []


async def test_text_metadata_counted_across_chunk_boundaries(session, storage_dir, monkeypatch):
    """Регрессия B4/B5: метаданные считаются потоково (fallback для записей без
    посчитанных при загрузке метаданных); multibyte-символ, разрезанный границей
    чанка, не должен ломать подсчёт."""
    monkeypatch.setattr(storage, "CHUNK_SIZE", 3)
    text = "héllo\nwörld"  # é и ö занимают 2 байта и попадают на границы чанков
    file_id = await seed_stored_file(session, storage_dir, text.encode(), "text/plain", ".txt")

    await service.process_file(session, file_id)

    file_item = await repository.get(session, file_id)
    assert file_item.metadata_json["line_count"] == len(text.splitlines()) == 2
    assert file_item.metadata_json["char_count"] == len(text) == 11
    assert file_item.processing_status == ProcessingStatus.PROCESSED


async def test_pdf_page_count_across_chunk_boundaries(session, storage_dir, monkeypatch):
    """Регрессия B4/B5: маркер страницы, попавший на границу чанков, должен учитываться."""
    monkeypatch.setattr(
        storage, "CHUNK_SIZE", 7
    )  # меньше длины маркера — каждый маркер режется границей
    content = b"%PDF-1.4 " + b"/Type /Page ...obj... " * 3 + b"trailer"
    file_id = await seed_stored_file(session, storage_dir, content, "application/pdf", ".pdf")

    await service.process_file(session, file_id)

    file_item = await repository.get(session, file_id)
    assert file_item.metadata_json["approx_page_count"] == 3


async def test_upload_computes_metadata_in_the_same_streaming_pass(
    session, storage_dir, monkeypatch
):
    """Шаг 4: метаданные контента считаются в том же потоковом проходе, что и запись
    на диск, — включая multibyte-символы на границах чанков."""
    monkeypatch.setattr(storage, "CHUNK_SIZE", 3)
    text = "héllo\nwörld"
    upload = ChunkRecordingUpload("sample.txt", text.encode())

    file_item = await service.create_file(session, title="sample", upload_file=upload)

    assert file_item.metadata_json == {
        "extension": ".txt",
        "size_bytes": len(text.encode()),
        "mime_type": "text/plain",
        "line_count": 2,
        "char_count": 11,
    }


async def test_worker_does_not_reread_file_when_metadata_precomputed(
    session, storage_dir, monkeypatch
):
    """Шаг 4: если метаданные посчитаны при загрузке, воркер не перечитывает файл."""
    content = b"%PDF-1.4 /Type /Page one /Type /Page two"
    upload = ChunkRecordingUpload("sample.pdf", content, "application/pdf")
    file_item = await service.create_file(session, title="sample", upload_file=upload)
    assert file_item.metadata_json["approx_page_count"] == 2

    def forbid_reread(stored_name):
        raise AssertionError("worker must not re-read the stored file")

    monkeypatch.setattr(storage, "iter_chunks", forbid_reread)
    await service.process_file(session, file_item.id)

    file_item = await repository.get(session, file_item.id)
    assert file_item.processing_status == ProcessingStatus.PROCESSED
    assert file_item.metadata_json["approx_page_count"] == 2
