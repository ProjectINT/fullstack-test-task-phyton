from datetime import datetime

from pydantic import BaseModel, ConfigDict

from src.alerts.enums import AlertLevel


class AlertItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    file_id: str
    file_title: str
    level: AlertLevel
    message: str
    created_at: datetime
