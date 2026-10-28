"""Route-level tests for the two Telegram OIDC endpoints
(POST /api/auth/telegram-guest and /api/auth/telegram-signup) — the only
routes whose happy paths the parity goldens do not exercise. The
id_token is minted against a random per-process test keypair like the parity
harness does; JWKS is mocked via respx, Redis is faked, and the signup's
organizer-exists lookup is patched — no Postgres needed.
"""

from __future__ import annotations

import time

import countmein.routes.auth as auth_routes
import fakeredis.aioredis
import httpx
import pytest
import respx
from _oidc_helpers import (
    id_token_claims,
    make_rsa_key,
    new_verifier,
    nonce_for,
    sign_id_token,
)
from _oidc_helpers import (
    jwks as _oidc_jwks,
)
from _oidc_helpers import (
    mint_id_token_payload as _mint_payload,
)
from countmein import redis as redis_mod
from countmein.auth import jwks as jwks_mod
from httpx import ASGITransport, AsyncClient

BOT_TOKEN = "123456:test-bot-token-00000000000000000000"
BOT_ID = "123456"
TEST_SECRET = "route-test-secret-0000000000000000000000"
TEST_KID = "oidc-1"

_PRIVATE_KEY = make_rsa_key()


def _jwk_set() -> dict:
    return _oidc_jwks(_PRIVATE_KEY, TEST_KID)


def mint_id_token_payload(user_id: int, name: str) -> dict:
    """A real RS256 id_token + the verifier whose hash it carries — the
    {idToken, nonceVerifier} body the new flow posts."""
    return _mint_payload(user_id, name, aud=BOT_ID, key=_PRIVATE_KEY, kid=TEST_KID)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", BOT_TOKEN)
    monkeypatch.setenv("AUTH_SECRET", TEST_SECRET)
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    jwks_mod.reset_for_test()
    yield
    jwks_mod.reset_for_test()


@pytest.fixture()
def fake_redis(monkeypatch):
    fake = fakeredis.aioredis.FakeRedis()
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(redis_mod, "client", lambda: fake)
    return fake


@pytest.fixture()
def _jwks():
    """The JWKS URL mocked at the httpx transport — route tests must not
    touch the network."""
    with respx.mock(assert_all_called=False) as router:
        router.get(jwks_mod.JWKS_URL).mock(return_value=httpx.Response(200, json=_jwk_set()))
        yield


@pytest.fixture()
async def client(fake_redis, _jwks, monkeypatch):
    from countmein.app import create_app

    # The signup route's organizer-exists lookup is a DB read; patch it
    # so the route test stays at the HTTP seam.
    async def fake_exists(session, messenger, messenger_id):
        return messenger_id == "42"

    monkeypatch.setattr(auth_routes.organizer_repo, "exists_by_messenger", fake_exists)
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_telegram_guest_issues_ticket(client):
    resp = await client.post("/api/auth/telegram-guest", json=mint_id_token_payload(7, "Guest"))
    assert resp.status_code == 200
    body = resp.json()
    assert body["messenger"] == "telegram"
    assert body["messengerId"] == "7"
    assert body["displayName"] == "Guest"
    assert body["ticket"]


async def test_telegram_guest_rejects_bad_token(client):
    resp = await client.post(
        "/api/auth/telegram-guest",
        json={"idToken": "x.y.z", "nonceVerifier": "a" * 43},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]


async def test_telegram_signup_reports_existing_organizer(client):
    resp = await client.post("/api/auth/telegram-signup", json=mint_id_token_payload(42, "Org"))
    assert resp.status_code == 200
    body = resp.json()
    assert body["organizerExists"] is True
    assert body["ticket"]


async def test_telegram_signup_reports_new_organizer(client):
    resp = await client.post("/api/auth/telegram-signup", json=mint_id_token_payload(43, "New Org"))
    assert resp.status_code == 200
    body = resp.json()
    assert body["organizerExists"] is False
    assert body["ticket"]


async def test_telegram_signup_rejects_expired_token(client):
    """An expired id_token is the new freshness refusal — same 400 class
    as the old stale auth_date."""
    verifier = new_verifier()
    now = int(time.time())
    token = sign_id_token(
        id_token_claims(
            nonce_for(verifier),
            BOT_ID,
            iat=now - 120,
            exp=now - 60,
            id="42",
            name="Org",
            given_name="",
            family_name="",
            preferred_username="",
            picture="",
        ),
        _PRIVATE_KEY,
        TEST_KID,
    )
    resp = await client.post(
        "/api/auth/telegram-signup", json={"idToken": token, "nonceVerifier": verifier}
    )
    assert resp.status_code == 400
    assert resp.json()["error"]


async def test_telegram_guest_rejects_replay(client):
    payload = mint_id_token_payload(7, "Guest")
    resp = await client.post("/api/auth/telegram-guest", json=payload)
    assert resp.status_code == 200
    resp = await client.post("/api/auth/telegram-guest", json=payload)
    assert resp.status_code == 400


async def test_telegram_guest_rejects_malformed_body(client):
    resp = await client.post("/api/auth/telegram-guest", json={})
    assert resp.status_code == 400
    assert resp.json()["error"]
