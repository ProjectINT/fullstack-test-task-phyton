"""Юниты краевых случаев: анализаторы контента, сторадж, определение mime при загрузке."""

import pytest

from src.core.exceptions import StoredFileNotFound
from src.files import service, storage
from src.files.service import _PdfPageAnalyzer, _TextStatsAnalyzer


class FakeUpload:
    """Минимальный async-дублёр UploadFile для проверки определения mime."""

    def __init__(self, filename: str, content: bytes, content_type: str | None):
        self.filename = filename
        self.content_type = content_type
        self._content = content

    async def read(self, size: int = -1) -> bytes:
        chunk, self._content = self._content, b""
        return chunk


def test_text_stats_count_last_line_without_trailing_newline():
    analyzer = _TextStatsAnalyzer()
    analyzer.feed(b"first\nsecond")

    assert analyzer.finalize() == {"line_count": 2, "char_count": 12}


def test_text_stats_for_empty_input_are_zero():
    analyzer = _TextStatsAnalyzer()

    assert analyzer.finalize() == {"line_count": 0, "char_count": 0}


def test_pdf_without_page_markers_reports_at_least_one_page():
    analyzer = _PdfPageAnalyzer()
    analyzer.feed(b"%PDF-1.4 no markers here trailer")

    assert analyzer.finalize() == {"approx_page_count": 1}


async def test_storage_resolve_missing_file_raises(storage_dir):
    with pytest.raises(StoredFileNotFound):
        await storage.resolve("missing.bin")


async def test_storage_delete_is_idempotent(storage_dir):
    await storage.delete("missing.bin")  # не должно падать


async def test_upload_without_content_type_guesses_mime_from_extension(session, storage_dir):
    upload = FakeUpload("notes.txt", b"hello", content_type=None)

    file_item = await service.create_file(session, title="notes", upload_file=upload)

    assert file_item.mime_type == "text/plain"
    assert file_item.metadata_json["char_count"] == 5


async def test_upload_removes_stored_file_when_commit_fails(session, storage_dir, monkeypatch):
    upload = FakeUpload("notes.txt", b"hello", content_type=None)

    async def failing_commit() -> None:
        raise RuntimeError("db is down")

    monkeypatch.setattr(session, "commit", failing_commit)

    with pytest.raises(RuntimeError, match="db is down"):
        await service.create_file(session, title="notes", upload_file=upload)

    # без компенсации на диске остался бы файл-сирота без записи в БД
    assert list(storage_dir.iterdir()) == []


async def test_upload_keeps_stored_file_after_successful_commit(session, storage_dir):
    upload = FakeUpload("notes.txt", b"hello", content_type=None)

    file_item = await service.create_file(session, title="notes", upload_file=upload)

    assert (storage_dir / file_item.stored_name).read_bytes() == b"hello"


async def test_upload_with_unknown_extension_falls_back_to_octet_stream(session, storage_dir):
    upload = FakeUpload("data.unknownext", b"payload", content_type=None)

    file_item = await service.create_file(session, title="data", upload_file=upload)

    assert file_item.mime_type == "application/octet-stream"
    # для бинарного mime контент-анализатора нет — только базовые метаданные
    assert file_item.metadata_json == {
        "extension": ".unknownext",
        "size_bytes": 7,
        "mime_type": "application/octet-stream",
    }
