"""CRUD-эндпоинты /files: error-пути (404) и happy-пути, не покрытые другими тестами."""

from uuid import uuid4

import pytest

SAMPLE_CONTENT = b"hello\nworld\n"


async def upload_sample(client, title: str = "sample") -> dict:
    response = await client.post(
        "/files",
        data={"title": title},
        files={"file": ("sample.txt", SAMPLE_CONTENT, "text/plain")},
    )
    assert response.status_code == 201
    return response.json()


@pytest.mark.parametrize("method,url_suffix,kwargs", [
    ("GET", "", {}),
    ("PATCH", "", {"json": {"title": "renamed"}}),
    ("DELETE", "", {}),
    ("GET", "/download", {}),
])
async def test_missing_file_returns_404(client, method, url_suffix, kwargs):
    response = await client.request(method, f"/files/{uuid4()}{url_suffix}", **kwargs)

    assert response.status_code == 404
    assert response.json() == {"detail": "File not found"}


async def test_download_when_stored_file_missing_on_disk_returns_404(client, storage_dir):
    """Запись в БД есть, а файла на диске нет — StoredFileNotFound, а не 500."""
    uploaded = await upload_sample(client)
    for stored in storage_dir.iterdir():
        stored.unlink()

    response = await client.get(f"/files/{uploaded['id']}/download")

    assert response.status_code == 404
    assert response.json() == {"detail": "Stored file not found"}


async def test_download_returns_original_content_and_filename(client):
    uploaded = await upload_sample(client)

    response = await client.get(f"/files/{uploaded['id']}/download")

    assert response.status_code == 200
    assert response.content == SAMPLE_CONTENT
    assert response.headers["content-type"].startswith("text/plain")
    assert "sample.txt" in response.headers["content-disposition"]


async def test_patch_updates_title_and_persists(client):
    uploaded = await upload_sample(client, title="before")

    response = await client.patch(f"/files/{uploaded['id']}", json={"title": "after"})

    assert response.status_code == 200
    assert response.json()["title"] == "after"
    fetched = await client.get(f"/files/{uploaded['id']}")
    assert fetched.json()["title"] == "after"


async def test_upload_response_has_status_and_precomputed_metadata(client):
    uploaded = await upload_sample(client)

    assert uploaded["processing_status"] == "uploaded"
    assert uploaded["scan_status"] is None
    assert uploaded["requires_attention"] is False
    assert uploaded["size"] == len(SAMPLE_CONTENT)
    assert uploaded["metadata_json"] == {
        "extension": ".txt",
        "size_bytes": len(SAMPLE_CONTENT),
        "mime_type": "text/plain",
        "line_count": 2,
        "char_count": len(SAMPLE_CONTENT),
    }
