"""Port of pkg/httpx/guards_test.go (+ TestReadBodyOr413 from
response_test.go) — the request-level doors every write passes.
require_writable_organizer closes "an anonymous visitor writes as an
organizer" (ADR-010); require_guest_identity closes "a replayed ticket
books twice" (ADR-008, invariant 8). Redis-backed state (rate buckets,
tickets) runs against fakeredis.
"""

from __future__ import annotations

import time
from collections.abc import Mapping

import pytest
from _lib.countmein import redis as redis_mod
from _lib.countmein.auth.session import ORGANIZER_AUTH_HEADER
from _lib.countmein.auth.telegram import TICKET_PURPOSE_GUEST, TICKET_PURPOSE_ORGANIZER
from _lib.countmein.auth.ticket import issue_ticket
from _lib.countmein.contracts.constants_gen import DEMO_ORGANIZER_ID
from _lib.countmein.contracts.payloads import AuthTicketPayload
from _lib.countmein.httpx_.guards import (
    read_body_or_413,
    require_guest_identity,
    require_writable_organizer,
)

TEST_SECRET = "guards-test-golden-secret"


@pytest.fixture()
async def fake_redis(monkeypatch):
    import fakeredis.aioredis

    fake = fakeredis.aioredis.FakeRedis()
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(redis_mod, "client", lambda: fake)
    yield fake
    await fake.aclose()


@pytest.fixture(autouse=True)
def _secret(monkeypatch):
    monkeypatch.setenv("AUTH_SECRET", TEST_SECRET)


def mint_test_token(secret: str, sub: str, slug: str, exp: int) -> str:
    """The shared organizer-auth mint (the derivation itself is pinned
    by the golden test in tests_py/auth/test_session.py)."""
    import base64
    import hashlib
    import hmac
    import json

    from _lib.countmein.auth.session import derived_signing_key

    header = (
        base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
        .rstrip(b"=")
        .decode()
    )
    payload = (
        base64.urlsafe_b64encode(
            json.dumps({"sub": sub, "slug": slug, "iat": int(time.time()), "exp": exp}).encode()
        )
        .rstrip(b"=")
        .decode()
    )
    signing_input = f"{header}.{payload}"
    sig = hmac.new(derived_signing_key(secret), signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{base64.urlsafe_b64encode(sig).rstrip(b'=').decode()}"


def guard_request(headers: Mapping[str, str] | None = None):
    from starlette.requests import Request

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/services",
        "raw_path": b"/api/services",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "query_string": b"",
        "client": ("127.0.0.1", 12345),
        "scheme": "http",
        "server": ("testserver", 80),
        "http_version": "1.1",
    }
    return Request(scope)


# ── require_writable_organizer ────────────────────────────────────────────────


async def test_require_writable_organizer_anonymous(fake_redis):
    organizer_id, resp = await require_writable_organizer(guard_request())
    assert resp is not None and resp.status == 403, (
        "anonymous request must be refused as demo read-only"
    )
    assert organizer_id == "", "refused request must not leak an organizer id"


async def test_require_writable_organizer_demo_session(fake_redis):
    token = mint_test_token(TEST_SECRET, DEMO_ORGANIZER_ID, "demo", int(time.time()) + 60)
    _organizer_id, resp = await require_writable_organizer(
        guard_request({ORGANIZER_AUTH_HEADER: token})
    )
    assert resp is not None and resp.status == 403, "demo session must be refused as demo read-only"


async def test_require_writable_organizer_signed_in(fake_redis):
    # Unique id per test: the rate bucket is keyed by organizer id and
    # lives in the shared fakeredis for the whole module run.
    own_id = "01930000-0000-7000-8000-0000000000a1"
    token = mint_test_token(TEST_SECRET, own_id, "studio", int(time.time()) + 60)
    organizer_id, resp = await require_writable_organizer(
        guard_request({ORGANIZER_AUTH_HEADER: token})
    )
    assert resp is None, "signed-in organizer must pass"
    assert organizer_id == own_id


async def test_require_writable_organizer_rate_limit(fake_redis):
    own_id = "01930000-0000-7000-8000-0000000000a2"
    minted = mint_test_token(TEST_SECRET, own_id, "studio", int(time.time()) + 60)

    # 60/min: the first 60 requests pass, the 61st is a 429.
    for i in range(60):
        organizer_id, resp = await require_writable_organizer(
            guard_request({ORGANIZER_AUTH_HEADER: minted})
        )
        assert resp is None, f"request {i + 1} within the limit must pass"
        assert organizer_id == own_id
    organizer_id, resp = await require_writable_organizer(
        guard_request({ORGANIZER_AUTH_HEADER: minted})
    )
    assert resp is not None and resp.status == 429, "request 61 must be a 429"
    assert resp.headers.get("Retry-After", "") != "", "429 must carry a Retry-After header"


# ── require_guest_identity ────────────────────────────────────────────────────


def guest_payload(purpose: str) -> AuthTicketPayload:
    return AuthTicketPayload(
        messenger="telegram",
        messenger_id="123456789",
        display_name="Ann",
        messenger_login=None,
        purpose=purpose,
    )


async def test_require_guest_identity_consume_once(fake_redis):
    ticket = await issue_ticket(guest_payload(TICKET_PURPOSE_GUEST))

    # First redemption: the payload comes back.
    payload, resp = await require_guest_identity(guard_request(), ticket)
    assert resp is None, "first redemption must pass"
    assert payload is not None
    assert payload.messenger_id == "123456789"
    assert payload.purpose == TICKET_PURPOSE_GUEST

    # Replay: the ticket was consumed (GETDEL), so the second attempt is
    # answered like an expired one — 401, never a second identity.
    payload, resp = await require_guest_identity(guard_request(), ticket)
    assert resp is not None and resp.status == 401, "replayed ticket must be a 401"


async def test_require_guest_identity_unknown_ticket(fake_redis):
    _payload, resp = await require_guest_identity(guard_request(), "no-such-ticket")
    assert resp is not None and resp.status == 401, "unknown ticket must be a 401"


async def test_require_guest_identity_signup_purpose_refused(fake_redis):
    # ADR-008: a ticket minted for organizer registration must not be
    # redeemable in the booking flow — answered like an expired one so
    # the caller cannot distinguish "wrong flow" from "unknown ticket".
    ticket = await issue_ticket(guest_payload(TICKET_PURPOSE_ORGANIZER))
    _payload, resp = await require_guest_identity(guard_request(), ticket)
    assert resp is not None and resp.status == 401, (
        "signup ticket in the booking flow must be a 401"
    )
    # And the refusal must have consumed it — it cannot be retried as guest either.
    _payload, resp = await require_guest_identity(guard_request(), ticket)
    assert resp is not None and resp.status == 401, "consumed ticket must be a 401 on retry"


async def test_require_guest_identity_broken_payload(fake_redis):
    # Corrupt JSON behind the key is "no payload usable" → 401, not a 500.
    await fake_redis.set("auth:ticket:broken", "not-json{")
    _payload, resp = await require_guest_identity(guard_request(), "broken")
    assert resp is not None and resp.status == 401, "broken ticket payload must be a 401"


async def test_require_guest_identity_redis_down(monkeypatch):
    """Identity is NOT fail-open (ADR-019): only the rate limiter fails
    open; a Redis outage must refuse the write with a 500 rather than
    let an unverifiable identity through."""

    class Dead:
        async def getdel(self, *a, **kw):
            raise ConnectionError("redis down")

    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(redis_mod, "client", lambda: Dead())
    _payload, resp = await require_guest_identity(guard_request(), "any-ticket")
    assert resp is not None and resp.status == 500, "Redis outage must be a 500 for identity"


# ── read_body_or_413 (response_test.go) ───────────────────────────────────────


def body_request(body: bytes):
    from starlette.requests import Request

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/x",
        "raw_path": b"/api/x",
        "headers": [(b"content-type", b"application/json")],
        "query_string": b"",
        "client": ("127.0.0.1", 12345),
        "scheme": "http",
        "server": ("testserver", 80),
        "http_version": "1.1",
    }
    request = Request(scope)
    request._body = body
    return request


async def test_read_body_or_413():
    # small body passes through
    body, resp = await read_body_or_413(body_request(b'{"a":1}'))
    assert resp is None, "expected ok for a small body"
    assert body == b'{"a":1}'

    # body over 1MB answers 413
    big = b"x" * ((1 << 20) + 1)
    body, resp = await read_body_or_413(body_request(big))
    assert resp is not None, "oversized body must be refused"
    assert resp.status == 413
    assert resp.headers.get("Connection") == "close"

    # exactly 1MB is the bound itself — still allowed
    body, resp = await read_body_or_413(body_request(b"x" * (1 << 20)))
    assert resp is None, "the bound is inclusive: exactly 1MB passes"
