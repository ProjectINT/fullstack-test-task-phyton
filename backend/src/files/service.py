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


async def list_files(session: AsyncSession) -> list[StoredFile]:
    return await repository.list_files(session)


async def get_file(session: AsyncSession, file_id: str) -> StoredFile:
    file_item = await repository.get(session, file_id)
    if not file_item:
        raise FileNotFound
    return file_item


async def resolve_path(file_item: StoredFile) -> Path:
    return await storage.resolve(file_item.stored_name)


async def _read_upload_chunks(upload_file: UploadFile) -> AsyncIterator[bytes]:
    total = 0
    while chunk := await upload_file.read(storage.CHUNK_SIZE):
        total += len(chunk)
        if total > settings.max_file_size:
            raise FileTooLarge
        yield chunk


async def create_file(session: AsyncSession, title: str, upload_file: UploadFile) -> StoredFile:
    file_id = str(uuid4())
    suffix = Path(upload_file.filename or "").suffix
    stored_name = f"{file_id}{suffix}"

    try:
        size = await storage.save(stored_name, _read_upload_chunks(upload_file))
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
        mime_type=upload_file.content_type or mimetypes.guess_type(stored_name)[0] or "application/octet-stream",
        size=size,
        processing_status=ProcessingStatus.UPLOADED,
    )
    repository.add(session, file_item)
    await session.commit()
    await session.refresh(file_item)
    return file_item


async def update_file(session: AsyncSession, file_id: str, title: str) -> StoredFile:
    file_item = await get_file(session, file_id)
    file_item.title = title
    await session.commit()
    await session.refresh(file_item)
    return file_item


async def delete_file(session: AsyncSession, file_id: str) -> None:
    file_item = await get_file(session, file_id)
    stored_name = file_item.stored_name
    await repository.delete(session, file_item)
    await session.commit()
    await storage.delete(stored_name)


async def scan_file_for_threats(session: AsyncSession, file_id: str) -> bool:
    """Returns False when the file no longer exists and the pipeline must stop."""
    file_item = await repository.get(session, file_id)
    if not file_item:
        return False

    # B8: промежуточный статус коммитим отдельно, чтобы он был виден до окончания скана
    file_item.processing_status = ProcessingStatus.PROCESSING
    await session.commit()

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
    await session.commit()
    return True


async def _count_text_stats(stored_name: str) -> tuple[int, int]:
    """Число строк и символов одним потоковым проходом; multibyte-символы на границе
    чанков дособирает инкрементальный декодер."""
    decoder = codecs.getincrementaldecoder("utf-8")(errors="ignore")
    line_count = 0
    char_count = 0
    ends_with_newline = True

    async for chunk in storage.iter_chunks(stored_name):
        text = decoder.decode(chunk)
        if text:
            line_count += text.count("\n")
            char_count += len(text)
            ends_with_newline = text.endswith("\n")
    text = decoder.decode(b"", final=True)
    if text:
        line_count += text.count("\n")
        char_count += len(text)
        ends_with_newline = text.endswith("\n")

    if char_count and not ends_with_newline:
        line_count += 1
    return line_count, char_count


async def _count_pdf_pages(stored_name: str) -> int:
    """Считает вхождения маркера страницы, не теряя те, что попали на границу чанков."""
    count = 0
    tail = b""
    async for chunk in storage.iter_chunks(stored_name):
        window = tail + chunk
        count += window.count(PDF_PAGE_MARKER)
        tail = window[1 - len(PDF_PAGE_MARKER):]
    return count


async def extract_file_metadata(session: AsyncSession, file_id: str) -> bool:
    """Returns False when the file no longer exists and the pipeline must stop."""
    file_item = await repository.get(session, file_id)
    if not file_item:
        return False

    if not await storage.exists(file_item.stored_name):
        file_item.processing_status = ProcessingStatus.FAILED
        file_item.scan_status = file_item.scan_status or ScanStatus.FAILED
        file_item.scan_details = "stored file not found during metadata extraction"
        await session.commit()
        return True

    metadata = {
        "extension": Path(file_item.original_name).suffix.lower(),
        "size_bytes": file_item.size,
        "mime_type": file_item.mime_type,
    }

    if file_item.mime_type.startswith("text/"):
        line_count, char_count = await _count_text_stats(file_item.stored_name)
        metadata["line_count"] = line_count
        metadata["char_count"] = char_count
    elif file_item.mime_type == "application/pdf":
        metadata["approx_page_count"] = max(await _count_pdf_pages(file_item.stored_name), 1)

    file_item.metadata_json = metadata
    file_item.processing_status = ProcessingStatus.PROCESSED
    await session.commit()
    return True


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


async def send_file_alert(session: AsyncSession, file_id: str) -> None:
    file_item = await repository.get(session, file_id)
    if not file_item:
        return

    if file_item.processing_status == ProcessingStatus.FAILED:
        alert = Alert(file_id=file_id, level=AlertLevel.CRITICAL, message="File processing failed")
    elif file_item.requires_attention:
        alert = Alert(
            file_id=file_id,
            level=AlertLevel.WARNING,
            message=f"File requires attention: {file_item.scan_details}",
        )
    else:
        alert = Alert(file_id=file_id, level=AlertLevel.INFO, message="File processed successfully")

    alerts_repository.add(session, alert)
    await session.commit()
