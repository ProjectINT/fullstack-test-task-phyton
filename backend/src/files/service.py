import codecs
import mimetypes
from collections.abc import AsyncIterator
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from src.alerts import repository as alerts_repository
from src.alerts.enums import AlertLevel
from src.alerts.models import Alert
from src.core.config import settings
from src.core.exceptions import EmptyFile, FileNotFound, FileTooLarge
from src.files import repository, storage
from src.files.enums import ProcessingStatus, ScanStatus
from src.files.models import StoredFile

SUSPICIOUS_EXTENSIONS = {".exe", ".bat", ".cmd", ".sh", ".js"}
SUSPICIOUS_SIZE_BYTES = 10 * 1024 * 1024
PDF_PAGE_MARKER = b"/Type /Page"


async def list_files(session: AsyncSession, limit: int, offset: int) -> list[StoredFile]:
    return await repository.list_files(session, limit=limit, offset=offset)


async def get_file(session: AsyncSession, file_id: str) -> StoredFile:
    file_item = await repository.get(session, file_id)
    if not file_item:
        raise FileNotFound
    return file_item


async def get_file_for_download(session: AsyncSession, file_id: str) -> tuple[StoredFile, Path]:
    file_item = await get_file(session, file_id)
    stored_path = await storage.resolve(file_item.stored_name)
    return file_item, stored_path


class _TextStatsAnalyzer:
    """Число строк и символов; multibyte-символы на границе чанков дособирает
    инкрементальный декодер."""

    def __init__(self) -> None:
        self._decoder = codecs.getincrementaldecoder("utf-8")(errors="ignore")
        self._line_count = 0
        self._char_count = 0
        self._ends_with_newline = True

    def _consume(self, text: str) -> None:
        if text:
            self._line_count += text.count("\n")
            self._char_count += len(text)
            self._ends_with_newline = text.endswith("\n")

    def feed(self, chunk: bytes) -> None:
        self._consume(self._decoder.decode(chunk))

    def finalize(self) -> dict:
        self._consume(self._decoder.decode(b"", final=True))
        line_count = self._line_count
        if self._char_count and not self._ends_with_newline:
            line_count += 1
        return {"line_count": line_count, "char_count": self._char_count}


class _PdfPageAnalyzer:
    """Считает вхождения маркера страницы, не теряя те, что попали на границу чанков."""

    def __init__(self) -> None:
        self._count = 0
        self._tail = b""

    def feed(self, chunk: bytes) -> None:
        window = self._tail + chunk
        self._count += window.count(PDF_PAGE_MARKER)
        self._tail = window[1 - len(PDF_PAGE_MARKER):]

    def finalize(self) -> dict:
        return {"approx_page_count": max(self._count, 1)}


ContentAnalyzer = _TextStatsAnalyzer | _PdfPageAnalyzer


def _content_analyzer_for(mime_type: str) -> ContentAnalyzer | None:
    if mime_type.startswith("text/"):
        return _TextStatsAnalyzer()
    if mime_type == "application/pdf":
        return _PdfPageAnalyzer()
    return None


def _build_metadata(file_item: StoredFile, content_stats: dict) -> dict:
    return {
        "extension": Path(file_item.original_name).suffix.lower(),
        "size_bytes": file_item.size,
        "mime_type": file_item.mime_type,
        **content_stats,
    }


async def _read_upload_chunks(upload_file: UploadFile, analyzer: ContentAnalyzer | None) -> AsyncIterator[bytes]:
    total = 0
    while chunk := await upload_file.read(storage.CHUNK_SIZE):
        total += len(chunk)
        if total > settings.max_file_size:
            raise FileTooLarge
        if analyzer:
            analyzer.feed(chunk)
        yield chunk


async def create_file(session: AsyncSession, title: str, upload_file: UploadFile) -> StoredFile:
    file_id = str(uuid4())
    suffix = Path(upload_file.filename or "").suffix
    stored_name = f"{file_id}{suffix}"
    mime_type = upload_file.content_type or mimetypes.guess_type(stored_name)[0] or "application/octet-stream"

    # Метаданные контента считаются в том же потоковом проходе, что и запись на диск, —
    # воркеру не приходится перечитывать файл.
    analyzer = _content_analyzer_for(mime_type)
    try:
        size = await storage.save(stored_name, _read_upload_chunks(upload_file, analyzer))
    except FileTooLarge:
        await storage.delete(stored_name)
        raise
    if size == 0:
        await storage.delete(stored_name)
        raise EmptyFile

    file_item = StoredFile(
        id=file_id,
        title=title,
        original_name=upload_file.filename or stored_name,
        stored_name=stored_name,
        mime_type=mime_type,
        size=size,
        processing_status=ProcessingStatus.UPLOADED,
    )
    file_item.metadata_json = _build_metadata(file_item, analyzer.finalize() if analyzer else {})
    repository.add(session, file_item)
    await session.commit()
    return file_item


async def update_file(session: AsyncSession, file_id: str, title: str) -> StoredFile:
    file_item = await get_file(session, file_id)
    file_item.title = title
    await session.commit()
    return file_item


async def delete_file(session: AsyncSession, file_id: str) -> None:
    file_item = await get_file(session, file_id)
    stored_name = file_item.stored_name
    await repository.delete(session, file_item)
    await session.commit()
    await storage.delete(stored_name)


def _scan_for_threats(file_item: StoredFile) -> None:
    reasons: list[str] = []
    extension = Path(file_item.original_name).suffix.lower()

    if extension in SUSPICIOUS_EXTENSIONS:
        reasons.append(f"suspicious extension {extension}")

    if file_item.size > SUSPICIOUS_SIZE_BYTES:
        reasons.append("file is larger than 10 MB")

    if extension == ".pdf" and file_item.mime_type not in {"application/pdf", "application/octet-stream"}:
        reasons.append("pdf extension does not match mime type")

    file_item.scan_status = ScanStatus.SUSPICIOUS if reasons else ScanStatus.CLEAN
    file_item.scan_details = ", ".join(reasons) if reasons else "no threats found"
    file_item.requires_attention = bool(reasons)


async def _ensure_metadata(file_item: StoredFile) -> None:
    """Обычно метаданные уже посчитаны при загрузке; для записей без них
    (загруженных до этой оптимизации) — один потоковый проход по файлу."""
    if file_item.metadata_json is not None:
        return

    analyzer = _content_analyzer_for(file_item.mime_type)
    content_stats: dict = {}
    if analyzer:
        async for chunk in storage.iter_chunks(file_item.stored_name):
            analyzer.feed(chunk)
        content_stats = analyzer.finalize()
    file_item.metadata_json = _build_metadata(file_item, content_stats)


def _build_alert(file_item: StoredFile) -> Alert:
    if file_item.requires_attention:
        return Alert(
            file_id=file_item.id,
            level=AlertLevel.WARNING,
            message=f"File requires attention: {file_item.scan_details}",
        )
    return Alert(file_id=file_item.id, level=AlertLevel.INFO, message="File processed successfully")


async def process_file(session: AsyncSession, file_id: str) -> None:
    """Весь конвейер (скан → метаданные → алерт) одним проходом: одна сессия
    и одна выборка записи вместо трёх задач с тремя engine/сессиями/фетчами."""
    file_item = await repository.get(session, file_id)
    if not file_item:
        return
    if file_item.processing_status == ProcessingStatus.PROCESSED:
        # ретрай после успешного финального коммита (например, потерян ack брокера):
        # результат и алерт уже записаны той же транзакцией — повтор создал бы дубликат алерта
        return

    # B8: промежуточный статус коммитим отдельно, чтобы он был виден до окончания обработки
    file_item.processing_status = ProcessingStatus.PROCESSING
    await session.commit()

    if not await storage.exists(file_item.stored_name):
        file_item.processing_status = ProcessingStatus.FAILED
        file_item.scan_status = file_item.scan_status or ScanStatus.FAILED
        file_item.scan_details = "stored file not found during processing"
        await session.commit()
        return

    _scan_for_threats(file_item)
    await _ensure_metadata(file_item)
    file_item.processing_status = ProcessingStatus.PROCESSED
    alerts_repository.add(session, _build_alert(file_item))
    # результат скана, метаданные и алерт — одной транзакцией
    await session.commit()


async def mark_file_failed(session: AsyncSession, file_id: str, reason: str) -> None:
    file_item = await repository.get(session, file_id)
    if not file_item:
        return

    file_item.processing_status = ProcessingStatus.FAILED
    if not file_item.scan_status:
        file_item.scan_status = ScanStatus.FAILED
    file_item.scan_details = reason[:500]
    alert = Alert(file_id=file_id, level=AlertLevel.CRITICAL, message=f"File processing failed: {reason}"[:500])
    alerts_repository.add(session, alert)
    await session.commit()
