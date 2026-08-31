from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse


class AppError(Exception):
    status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR
    detail: str = "Internal server error"

    def __init__(self, detail: str | None = None) -> None:
        if detail is not None:
            self.detail = detail
        super().__init__(self.detail)


class FileNotFound(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    detail = "File not found"


class StoredFileNotFound(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    detail = "Stored file not found"


class EmptyFile(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    detail = "File is empty"


class FileTooLarge(AppError):
    status_code = status.HTTP_413_CONTENT_TOO_LARGE
    detail = "File is too large"


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
