import mimetypes
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from src.alerts import repository as alerts_repository
from src.alerts.enums import AlertLevel
from src.alerts.models import Alert
from src.core.exceptions import EmptyFile, FileNotFound
from src.files import repository, storage
from src.files.enums import ProcessingStatus, ScanStatus
from src.files.models import StoredFile

SUSPICIOUS_EXTENSIONS = {".exe", ".bat", ".cmd", ".sh", ".js"}
SUSPICIOUS_SIZE_BYTES = 10 * 1024 * 1024


async def list_files(session: AsyncSession) -> list[StoredFile]:
    return await repository.list_files(session)


async def get_file(session: AsyncSession, file_id: str) -> StoredFile:
    file_item = await repository.get(session, file_id)
    if not file_item:
        raise FileNotFound
    return file_item


def resolve_path(file_item: StoredFile) -> Path:
    return storage.resolve(file_item.stored_name)


async def create_file(session: AsyncSession, title: str, upload_file: UploadFile) -> StoredFile:
    content = await upload_file.read()
    if not content:
        raise EmptyFile

    file_id = str(uuid4())
    suffix = Path(upload_file.filename or "").suffix
    stored_name = f"{file_id}{suffix}"
    storage.save(stored_name, content)

    file_item = StoredFile(
        id=file_id,
        title=title,
        original_name=upload_file.filename or stored_name,
        stored_name=stored_name,
        mime_type=upload_file.content_type or mimetypes.guess_type(stored_name)[0] or "application/octet-stream",
        size=len(content),
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
    storage.delete(stored_name)


async def scan_file_for_threats(session: AsyncSession, file_id: str) -> bool:
    """Returns False when the file no longer exists and the pipeline must stop."""
    file_item = await repository.get(session, file_id)
    if not file_item:
        return False

    file_item.processing_status = ProcessingStatus.PROCESSING
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


async def extract_file_metadata(session: AsyncSession, file_id: str) -> bool:
    """Returns False when the file no longer exists and the pipeline must stop."""
    file_item = await repository.get(session, file_id)
    if not file_item:
        return False

    stored_path = storage.path_for(file_item.stored_name)
    if not stored_path.exists():
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
        content = stored_path.read_text(encoding="utf-8", errors="ignore")
        metadata["line_count"] = len(content.splitlines())
        metadata["char_count"] = len(content)
    elif file_item.mime_type == "application/pdf":
        content = stored_path.read_bytes()
        metadata["approx_page_count"] = max(content.count(b"/Type /Page"), 1)

    file_item.metadata_json = metadata
    file_item.processing_status = ProcessingStatus.PROCESSED
    await session.commit()
    return True


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
