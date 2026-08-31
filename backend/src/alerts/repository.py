from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.alerts.models import Alert


async def list_alerts(session: AsyncSession, limit: int, offset: int) -> list[Alert]:
    result = await session.execute(
        select(Alert).order_by(Alert.created_at.desc()).limit(limit).offset(offset)
    )
    return list(result.scalars().all())


def add(session: AsyncSession, alert: Alert) -> None:
    session.add(alert)
