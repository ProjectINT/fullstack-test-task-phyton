from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.alerts.enums import AlertLevel
from src.core.db import Base, status_column


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    file_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("files.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    level: Mapped[AlertLevel] = mapped_column(status_column(AlertLevel), nullable=False)
    message: Mapped[str] = mapped_column(String(500), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
