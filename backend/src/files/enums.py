from enum import StrEnum


class ProcessingStatus(StrEnum):
    UPLOADED = "uploaded"
    PROCESSING = "processing"
    PROCESSED = "processed"
    FAILED = "failed"


class ScanStatus(StrEnum):
    CLEAN = "clean"
    SUSPICIOUS = "suspicious"
    FAILED = "failed"
