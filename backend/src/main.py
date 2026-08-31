from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.alerts.router import router as alerts_router
from src.core.exceptions import register_exception_handlers
from src.files.router import router as files_router

app = FastAPI(title="File processing service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)
app.include_router(files_router)
app.include_router(alerts_router)
