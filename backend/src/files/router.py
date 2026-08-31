from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.db import get_session
from src.files import service
from src.files.schemas import FileItem, FileUpdate
from src.worker.tasks import scan_file_for_threats

router = APIRouter(prefix="/files", tags=["files"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get("", response_model=list[FileItem])
async def list_files_view(session: SessionDep):
    return await service.list_files(session)


@router.post("", response_model=FileItem, status_code=201)
async def create_file_view(
    session: SessionDep,
    title: str = Form(...),
    file: UploadFile = File(...),
):
    file_item = await service.create_file(session, title=title, upload_file=file)
    scan_file_for_threats.delay(file_item.id)
    return file_item


@router.get("/{file_id}", response_model=FileItem)
async def get_file_view(file_id: str, session: SessionDep):
    return await service.get_file(session, file_id)


@router.patch("/{file_id}", response_model=FileItem)
async def update_file_view(file_id: str, payload: FileUpdate, session: SessionDep):
    return await service.update_file(session, file_id=file_id, title=payload.title)


@router.get("/{file_id}/download")
async def download_file_view(file_id: str, session: SessionDep):
    file_item = await service.get_file(session, file_id)
    stored_path = await service.resolve_path(file_item)
    return FileResponse(
        path=stored_path,
        media_type=file_item.mime_type,
        filename=file_item.original_name,
    )


@router.delete("/{file_id}", status_code=204)
async def delete_file_view(file_id: str, session: SessionDep):
    await service.delete_file(session, file_id)
