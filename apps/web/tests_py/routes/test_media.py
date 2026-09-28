"""Media upload route tests — the two signed-URL endpoints through the
FastAPI app: happy path (R2 env set, the presigner builds the URL
offline), demo/anonymous refusal, and validation envelopes. No network:
boto3's presigner is pure string signing."""

from __future__ import annotations

import json

import pytest

from ._helpers import auth_headers

ORGANIZER_ID = "01930000-0000-7000-8000-00000000aa01"

R2_ENV = {
    "R2_ACCOUNT_ID": "test-account",
    "R2_ACCESS_KEY_ID": "test-access-key",
    "R2_SECRET_ACCESS_KEY": "test-secret-key",
    "R2_BUCKET": "test-bucket",
    "R2_PUBLIC_BASE_URL": "https://media.example.com",
}


@pytest.fixture(autouse=True)
def _r2_env(monkeypatch):
    for k, v in R2_ENV.items():
        monkeypatch.setenv(k, v)
    from countmein import storage

    storage.reset_for_test()
    yield
    storage.reset_for_test()


AVATAR_BODY = {"contentType": "image/jpeg", "size": 204800}
SERVICE_PHOTO_BODY = {"contentType": "image/png", "size": 1048576}


async def test_avatar_upload_happy_path(client):
    resp = await client.post(
        "/api/organizers/me/avatar", json=AVATAR_BODY, headers=auth_headers(sub=ORGANIZER_ID)
    )
    assert resp.status_code == 200
    body = json.loads(resp.text)
    assert set(body) == {"uploadUrl", "publicUrl", "expiresAt"}
    assert body["publicUrl"].startswith("https://media.example.com/organizers/")
    assert "/avatar-" in body["publicUrl"]
    assert "X-Amz-Signature" in body["uploadUrl"]


async def test_service_photo_upload_happy_path(client):
    resp = await client.post(
        "/api/organizers/me/service-photo",
        json=SERVICE_PHOTO_BODY,
        headers=auth_headers(sub=ORGANIZER_ID),
    )
    assert resp.status_code == 200
    body = json.loads(resp.text)
    assert body["publicUrl"].startswith("https://media.example.com/organizers/")
    assert "/services/photo-" in body["publicUrl"]


async def test_avatar_upload_anonymous_refused(client):
    resp = await client.post("/api/organizers/me/avatar", json=AVATAR_BODY)
    assert resp.status_code == 403
    body = json.loads(resp.text)
    assert body["code"] == "DEMO_READ_ONLY"


async def test_avatar_upload_demo_refused(client):
    from countmein.contracts.constants_gen import DEMO_ORGANIZER_ID

    resp = await client.post(
        "/api/organizers/me/avatar", json=AVATAR_BODY, headers=auth_headers(sub=DEMO_ORGANIZER_ID)
    )
    assert resp.status_code == 403


async def test_avatar_upload_unsupported_content_type(client):
    resp = await client.post(
        "/api/organizers/me/avatar",
        json={"contentType": "image/gif", "size": 100},
        headers=auth_headers(sub=ORGANIZER_ID),
    )
    assert resp.status_code == 400
    body = json.loads(resp.text)
    assert "error" in body


async def test_avatar_upload_size_bound_enforced(client):
    resp = await client.post(
        "/api/organizers/me/avatar",
        json={"contentType": "image/jpeg", "size": 10 * 1024 * 1024},
        headers=auth_headers(sub=ORGANIZER_ID),
    )
    assert resp.status_code == 400
