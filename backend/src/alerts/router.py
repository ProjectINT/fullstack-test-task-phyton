from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.alerts import repository
from src.alerts.schemas import AlertItem
from src.core.db import get_session
from src.core.pagination import PaginationDep

router = APIRouter(prefix="/alerts", tags=["alerts"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get("", response_model=list[AlertItem])
async def list_alerts_view(session: SessionDep, pagination: PaginationDep):
    return await repository.list_alerts(session, limit=pagination.limit, offset=pagination.offset)
