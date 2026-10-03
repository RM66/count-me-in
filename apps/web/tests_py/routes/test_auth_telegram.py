"""Route-level tests for the two Telegram Login Widget endpoints
(POST /api/auth/telegram-guest and /api/auth/telegram-signup) — the only
routes whose happy paths the parity goldens do not exercise. The widget
HMAC is minted like the parity harness mints it; Redis is faked, and
the signup's organizer-exists lookup is patched — no Postgres needed."""

from __future__ import annotations

import hashlib
import hmac
import time

import countmein.routes.auth as auth_routes
import pytest
from countmein import redis as redis_mod
from httpx import ASGITransport, AsyncClient

BOT_TOKEN = "123456:test-bot-token-00000000000000000000"
TEST_SECRET = "route-test-secret-0000000000000000000000"


def mint_widget_payload(user_id: int, name: str) -> dict:
    """Telegram Login Widget payload with a valid HMAC (auth/telegram.py)."""
    data = {"id": user_id, "first_name": name, "auth_date": int(time.time())}
    dcs = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret = hashlib.sha256(BOT_TOKEN.encode()).digest()
    data["hash"] = hmac.new(secret, dcs.encode(), hashlib.sha256).hexdigest()
    return data


@pytest.fixture()
def fake_redis(monkeypatch):
    import fakeredis.aioredis

    fake = fakeredis.aioredis.FakeRedis()
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(redis_mod, "client", lambda: fake)
    yield fake
    import fakeredis.aioredis as _a

    _a.FakeRedis()


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", BOT_TOKEN)
    monkeypatch.setenv("AUTH_SECRET", TEST_SECRET)
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")


@pytest.fixture()
async def client(fake_redis, monkeypatch):
    from countmein.app import create_app

    # The signup route's organizer-exists lookup is a DB read; patch it
    # so the route test stays at the HTTP seam.
    async def fake_exists(session, messenger, messenger_id):
        return messenger_id == "42"

    monkeypatch.setattr(auth_routes.organizer_service, "exists_organizer_by_messenger", fake_exists)
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_telegram_guest_issues_ticket(client):
    payload = mint_widget_payload(7, "Guest")
    resp = await client.post("/api/auth/telegram-guest", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["messenger"] == "telegram"
    assert body["messengerId"] == "7"
    assert body["displayName"] == "Guest"
    assert body["ticket"]


async def test_telegram_guest_rejects_bad_hash(client):
    payload = mint_widget_payload(7, "Guest")
    payload["hash"] = "0" * 64
    resp = await client.post("/api/auth/telegram-guest", json=payload)
    assert resp.status_code == 400
    assert resp.json()["error"]


async def test_telegram_signup_reports_existing_organizer(client):
    payload = mint_widget_payload(42, "Org")
    resp = await client.post("/api/auth/telegram-signup", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["organizerExists"] is True
    assert body["ticket"]


async def test_telegram_signup_reports_new_organizer(client):
    payload = mint_widget_payload(43, "New Org")
    resp = await client.post("/api/auth/telegram-signup", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["organizerExists"] is False
    assert body["ticket"]


async def test_telegram_signup_rejects_stale_auth_date(client):
    payload = mint_widget_payload(42, "Org")
    # Outside the 24h freshness window (WIDGET_DATA_VALID_AFTER).
    payload["auth_date"] = int(time.time()) - 86400 - 3600
    # Re-sign with the stale auth_date so only freshness fails.
    data = {k: v for k, v in payload.items() if k != "hash"}
    dcs = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret = hashlib.sha256(BOT_TOKEN.encode()).digest()
    payload["hash"] = hmac.new(secret, dcs.encode(), hashlib.sha256).hexdigest()
    resp = await client.post("/api/auth/telegram-signup", json=payload)
    assert resp.status_code == 400
    assert resp.json()["error"]
