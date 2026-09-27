"""Fail-open without Redis, and
client-IP trust rules. The sliding-window behavior itself is covered
against fakeredis (the Go suite relies on the same Lua script running
in miniredis in the routes tests)."""

from __future__ import annotations

import pytest
from _lib.countmein.httpx_.ratelimit import RateLimitConfig, allow, client_ip


@pytest.fixture()
def clean_env(monkeypatch):
    monkeypatch.setenv("REDIS_URL", "")
    monkeypatch.setenv("VERCEL", "")
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "")


async def test_allow_fails_open_without_redis(clean_env, monkeypatch):
    """With no REDIS_URL the limiter must let every request through (a
    limiter outage must never block traffic)."""
    monkeypatch.setenv("REDIS_URL", "")
    allowed, _ = await allow("rl:test", RateLimitConfig(limit=1, window=60.0))
    assert allowed, "expected fail-open when REDIS_URL is unset"


async def test_allow_fails_open_on_redis_error(clean_env, monkeypatch):
    """A Redis outage mid-request also fails open (ADR-019)."""
    monkeypatch.setenv("REDIS_URL", "redis://localhost:1/0")

    class Boom:
        async def eval(self, *a, **kw):
            raise ConnectionError("redis down")

    import _lib.countmein.redis as redis_mod

    monkeypatch.setattr(redis_mod, "client", lambda: Boom())
    allowed, _ = await allow("rl:test", RateLimitConfig(limit=1, window=60.0))
    assert allowed, "expected fail-open when Redis errors"


def _request(headers: dict[str, str] | None = None, client_ip: str = "127.0.0.1"):
    """A minimal ASGI scope shaped like a Starlette Request."""
    from starlette.requests import Request

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "client": (client_ip, 12345),
        "query_string": b"",
    }
    return Request(scope)


def test_client_ip_untrusted_forwarded_for(clean_env):
    """The first value of the forwarded-for chain is the original client,
    but only when proxy headers are trusted (Vercel or
    TRUST_PROXY_HEADERS=1); otherwise the socket address is the answer,
    so a spoofed header cannot rotate rate-limit keys."""
    r = _request({"x-forwarded-for": "203.0.113.7, 10.0.0.1"})
    assert client_ip(r) != "203.0.113.7", "untrusted forwarded-for must be ignored"


def test_client_ip_trusted_forwarded_for(clean_env, monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    r = _request({"x-forwarded-for": "203.0.113.7, 10.0.0.1"})
    assert client_ip(r) == "203.0.113.7"


def test_client_ip_vercel_trusts_headers(clean_env, monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    r = _request({"x-vercel-forwarded-for": "198.51.100.9, 10.0.0.1"})
    assert client_ip(r) == "198.51.100.9"


def test_client_ip_remote_addr_fallback(clean_env):
    r = _request()
    assert client_ip(r) != "", "expected RemoteAddr fallback to be non-empty"


async def test_sliding_window_enforces_limit(monkeypatch):
    """The Lua script against fakeredis: limit 2 per 60s — the third hit
    is refused with a positive retry-after."""
    import fakeredis.aioredis

    fake = fakeredis.aioredis.FakeRedis()
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    import _lib.countmein.redis as redis_mod

    monkeypatch.setattr(redis_mod, "client", lambda: fake)

    cfg = RateLimitConfig(limit=2, window=60.0)
    key = "rl:window-test"
    assert await allow(key, cfg) == (True, 0.0)
    assert await allow(key, cfg) == (True, 0.0)
    allowed, retry_after = await allow(key, cfg)
    assert not allowed
    assert 0 < retry_after <= 60.0

    # A different key is a different bucket.
    assert await allow("rl:other", cfg) == (True, 0.0)
