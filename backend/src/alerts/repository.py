from sqlalchemy import Row, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.alerts.models import Alert
from src.files.models import StoredFile


async def list_alerts(
    session: AsyncSession, limit: int, offset: int
) -> list[Row[tuple[Alert, str]]]:
    result = await session.execute(
        select(Alert, StoredFile.title)
        .join(StoredFile, StoredFile.id == Alert.file_id)
        .order_by(Alert.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.all())


def add(session: AsyncSession, alert: Alert) -> None:
    session.add(alert)
