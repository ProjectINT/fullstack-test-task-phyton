from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, status_column
from src.files.enums import ProcessingStatus, ScanStatus


class StoredFile(Base):
    __tablename__ = "files"
    # server_default/onupdate-поля (created_at, updated_at) приходят через RETURNING
    # при INSERT/UPDATE — session.refresh после коммита не нужен
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    processing_status: Mapped[ProcessingStatus] = mapped_column(
        status_column(ProcessingStatus), nullable=False, default=ProcessingStatus.UPLOADED
    )
    scan_status: Mapped[ScanStatus | None] = mapped_column(status_column(ScanStatus), nullable=True)
    scan_details: Mapped[str | None] = mapped_column(String(500), nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    requires_attention: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
