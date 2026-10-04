"""The request-level doors every write passes.
require_writable_organizer closes "an anonymous visitor writes as an
organizer" (ADR-010); require_guest_identity closes "a replayed ticket
books twice" (ADR-008, invariant 8). Redis-backed state (rate buckets,
tickets) runs against fakeredis.

The guards raise ApiError subclasses instead of returning
(value, response) tuples; these tests pin the raised types, statuses,
and headers.
"""

from __future__ import annotations

import time
from collections.abc import Mapping

import pytest
from countmein import redis as redis_mod
from countmein.auth.session import ORGANIZER_AUTH_HEADER
from countmein.auth.telegram import TICKET_PURPOSE_GUEST, TICKET_PURPOSE_ORGANIZER
from countmein.auth.ticket import issue_ticket
from countmein.contracts.constants_gen import DEMO_ORGANIZER_ID
from countmein.contracts.payloads import AuthTicketPayload
from countmein.errors import DemoReadOnly, PayloadTooLarge, RateLimited, TicketExpired
from countmein.web.guards import (
    current_session,
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

    from countmein.auth.session import derived_signing_key

    header = (
        base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
        .rstrip(b"=")
        .decode()
    )
    payload = (
        base64.urlsafe_b64encode(
            json.dumps(
                {
                    "iss": "countmein-web",
                    "aud": "countmein-api",
                    "sub": sub,
                    "slug": slug,
                    "iat": int(time.time()),
                    "exp": exp,
                }
            ).encode()
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


async def _writable(headers: Mapping[str, str] | None = None) -> str:
    """The guard as FastAPI calls it: current_session resolves the
    header, the guard enforces the write rules."""
    req = guard_request(headers)
    return await require_writable_organizer(req, current_session(req))


async def test_require_writable_organizer_anonymous(fake_redis):
    with pytest.raises(DemoReadOnly) as exc_info:
        await _writable()
    assert exc_info.value.status == 403, "anonymous request must be refused as demo read-only"


async def test_require_writable_organizer_demo_session(fake_redis):
    token = mint_test_token(TEST_SECRET, DEMO_ORGANIZER_ID, "demo", int(time.time()) + 60)
    with pytest.raises(DemoReadOnly) as exc_info:
        await _writable({ORGANIZER_AUTH_HEADER: token})
    assert exc_info.value.status == 403, "demo session must be refused as demo read-only"


async def test_require_writable_organizer_signed_in(fake_redis):
    # Unique id per test: the rate bucket is keyed by organizer id and
    # lives in the shared fakeredis for the whole run.
    own_id = "01930000-0000-7000-8000-0000000000a1"
    token = mint_test_token(TEST_SECRET, own_id, "studio", int(time.time()) + 60)
    organizer_id = await _writable({ORGANIZER_AUTH_HEADER: token})
    assert organizer_id == own_id


async def test_require_writable_organizer_rate_limit(fake_redis):
    own_id = "01930000-0000-7000-8000-0000000000a2"
    minted = mint_test_token(TEST_SECRET, own_id, "studio", int(time.time()) + 60)

    # 60/min: the first 60 requests pass, the 61st is a 429.
    for i in range(60):
        organizer_id = await _writable({ORGANIZER_AUTH_HEADER: minted})
        assert organizer_id == own_id, f"request {i + 1} within the limit must pass"
    with pytest.raises(RateLimited) as exc_info:
        await _writable({ORGANIZER_AUTH_HEADER: minted})
    assert exc_info.value.status == 429, "request 61 must be a 429"
    assert exc_info.value.headers["Retry-After"] != "", "429 must carry a Retry-After header"


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
    payload = await require_guest_identity(ticket)
    assert payload.messenger_id == "123456789"
    assert payload.purpose == TICKET_PURPOSE_GUEST

    # Replay: the ticket was consumed (GETDEL) — the second attempt is
    # answered like an expired one, 401.
    with pytest.raises(TicketExpired) as exc_info:
        await require_guest_identity(ticket)
    assert exc_info.value.status == 401, "replayed ticket must be a 401"


async def test_require_guest_identity_unknown_ticket(fake_redis):
    with pytest.raises(TicketExpired) as exc_info:
        await require_guest_identity("no-such-ticket")
    assert exc_info.value.status == 401, "unknown ticket must be a 401"


async def test_require_guest_identity_signup_purpose_refused(fake_redis):
    # ADR-008: a signup-purpose ticket must not redeem in the booking
    # flow — answered like an expired one so "wrong flow" and "unknown
    # ticket" are indistinguishable.
    ticket = await issue_ticket(guest_payload(TICKET_PURPOSE_ORGANIZER))
    with pytest.raises(TicketExpired) as exc_info:
        await require_guest_identity(ticket)
    assert exc_info.value.status == 401, "signup ticket in the booking flow must be a 401"
    # The refusal must have consumed it — no retry as guest either.
    with pytest.raises(TicketExpired):
        await require_guest_identity(ticket)


async def test_require_guest_identity_broken_payload(fake_redis):
    # Corrupt JSON behind the key → 401, not a 500.
    await fake_redis.set("auth:ticket:broken", "not-json{")
    with pytest.raises(TicketExpired) as exc_info:
        await require_guest_identity("broken")
    assert exc_info.value.status == 401, "broken ticket payload must be a 401"


async def test_require_guest_identity_redis_down(monkeypatch):
    """Identity is NOT fail-open (ADR-019): only the rate limiter fails
    open — a Redis outage must refuse the write with a 500."""

    class Dead:
        async def getdel(self, *a, **kw):
            raise ConnectionError("redis down")

    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(redis_mod, "client", lambda: Dead())
    with pytest.raises(RuntimeError):
        await require_guest_identity("any-ticket")


# ── read_body_or_413 ──────────────────────────────────────────────────────────


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
    body = await read_body_or_413(body_request(b'{"a":1}'))
    assert body == b'{"a":1}'

    # body over 1MB answers 413
    big = b"x" * ((1 << 20) + 1)
    with pytest.raises(PayloadTooLarge) as exc_info:
        await read_body_or_413(body_request(big))
    assert exc_info.value.status == 413

    # exactly 1MB is the bound itself — still allowed
    body = await read_body_or_413(body_request(b"x" * (1 << 20)))
    assert body == b"x" * (1 << 20), "the bound is inclusive: exactly 1MB passes"


def streamed_request(chunks: list[bytes], content_length: str | None = None):
    """A request whose body arrives as a stream (no _body shortcut) —
    the guard's incremental read is what runs."""
    from starlette.requests import Request

    headers = [(b"content-type", b"application/json")]
    if content_length is not None:
        headers.append((b"content-length", content_length.encode()))
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/x",
        "raw_path": b"/api/x",
        "headers": headers,
        "query_string": b"",
        "client": ("127.0.0.1", 12345),
        "scheme": "http",
        "server": ("testserver", 80),
        "http_version": "1.1",
    }

    async def receive():
        for c in chunks:
            yield {"type": "http.request", "body": c, "more_body": True}
        yield {"type": "http.request", "body": b"", "more_body": False}

    request = Request(scope)
    gen = receive()

    async def _recv():
        return await gen.__anext__()

    request._receive = _recv
    return request


async def test_body_over_1mb_rejected_without_full_read():
    """A 2MB streamed body must be refused after ~1MB of chunks, not
    buffered whole first."""
    chunk = b"x" * 65536
    read = 0

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

    async def receive():
        nonlocal read
        while read < (2 << 20):
            read += 65536
            yield {"type": "http.request", "body": chunk, "more_body": True}
        yield {"type": "http.request", "body": b"", "more_body": False}

    request = Request(scope)
    gen = receive()

    async def _recv():
        return await gen.__anext__()

    request._receive = _recv
    with pytest.raises(PayloadTooLarge) as exc_info:
        await read_body_or_413(request)
    assert exc_info.value.status == 413, "a 2MB streamed body must be refused"
    assert read <= (1 << 20) + 65536, (
        f"the guard must abort reading after the bound, read {read} bytes"
    )


async def test_content_length_over_bound_refused_early():
    """Content-Length above 1MB is refused before any body chunk is
    read."""
    request = streamed_request([b"x" * 65536], content_length=str(2 << 20))
    with pytest.raises(PayloadTooLarge) as exc_info:
        await read_body_or_413(request)
    assert exc_info.value.status == 413
