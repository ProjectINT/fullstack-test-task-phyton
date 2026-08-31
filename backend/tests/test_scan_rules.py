"""Юнит-тесты скан-правил и построения алертов — чистые функции, без БД."""

from uuid import uuid4

import pytest

from src.alerts.enums import AlertLevel
from src.files.enums import ProcessingStatus, ScanStatus
from src.files.models import StoredFile
from src.files.service import SUSPICIOUS_SIZE_BYTES, _build_alert, _scan_for_threats


def make_file(original_name: str = "report.txt", size: int = 100, mime_type: str = "text/plain") -> StoredFile:
    return StoredFile(
        id=str(uuid4()),
        title="sample",
        original_name=original_name,
        stored_name="stored.bin",
        mime_type=mime_type,
        size=size,
        processing_status=ProcessingStatus.UPLOADED,
    )


def test_clean_file_passes_scan():
    file_item = make_file()

    _scan_for_threats(file_item)

    assert file_item.scan_status == ScanStatus.CLEAN
    assert file_item.scan_details == "no threats found"
    assert file_item.requires_attention is False


@pytest.mark.parametrize("extension", [".exe", ".bat", ".cmd", ".sh", ".js"])
def test_suspicious_extension_is_flagged(extension):
    file_item = make_file(original_name=f"payload{extension}", mime_type="application/octet-stream")

    _scan_for_threats(file_item)

    assert file_item.scan_status == ScanStatus.SUSPICIOUS
    assert f"suspicious extension {extension}" in file_item.scan_details
    assert file_item.requires_attention is True


def test_extension_check_is_case_insensitive():
    file_item = make_file(original_name="TROJAN.EXE", mime_type="application/octet-stream")

    _scan_for_threats(file_item)

    assert file_item.scan_status == ScanStatus.SUSPICIOUS


def test_size_at_threshold_is_clean_but_over_is_suspicious():
    at_limit = make_file(size=SUSPICIOUS_SIZE_BYTES)
    over_limit = make_file(size=SUSPICIOUS_SIZE_BYTES + 1)

    _scan_for_threats(at_limit)
    _scan_for_threats(over_limit)

    assert at_limit.scan_status == ScanStatus.CLEAN
    assert over_limit.scan_status == ScanStatus.SUSPICIOUS
    assert "larger than 10 MB" in over_limit.scan_details


@pytest.mark.parametrize("mime_type", ["application/pdf", "application/octet-stream"])
def test_pdf_with_expected_mime_is_clean(mime_type):
    file_item = make_file(original_name="doc.pdf", mime_type=mime_type)

    _scan_for_threats(file_item)

    assert file_item.scan_status == ScanStatus.CLEAN


def test_pdf_with_foreign_mime_is_flagged():
    file_item = make_file(original_name="doc.pdf", mime_type="text/html")

    _scan_for_threats(file_item)

    assert file_item.scan_status == ScanStatus.SUSPICIOUS
    assert "pdf extension does not match mime type" in file_item.scan_details


def test_multiple_reasons_are_joined():
    file_item = make_file(
        original_name="malware.exe",
        size=SUSPICIOUS_SIZE_BYTES + 1,
        mime_type="application/octet-stream",
    )

    _scan_for_threats(file_item)

    assert file_item.scan_details == "suspicious extension .exe, file is larger than 10 MB"


def test_clean_file_gets_info_alert():
    file_item = make_file()
    _scan_for_threats(file_item)

    alert = _build_alert(file_item)

    assert alert.level == AlertLevel.INFO
    assert alert.file_id == file_item.id
    assert alert.message == "File processed successfully"


def test_suspicious_file_gets_warning_alert_with_reasons():
    file_item = make_file(original_name="payload.sh", mime_type="application/octet-stream")
    _scan_for_threats(file_item)

    alert = _build_alert(file_item)

    assert alert.level == AlertLevel.WARNING
    assert alert.file_id == file_item.id
    assert "suspicious extension .sh" in alert.message
