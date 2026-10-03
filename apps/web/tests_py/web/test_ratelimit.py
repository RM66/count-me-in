"""Fail-open without Redis, and client-IP trust rules. The
sliding-window behavior is covered against fakeredis."""

from __future__ import annotations

import pytest
from countmein.web.ratelimit import RateLimitConfig, allow, client_ip


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

    import countmein.redis as redis_mod

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
    TRUST_PROXY_HEADERS=1); otherwise the socket address wins, so a
    spoofed header cannot rotate rate-limit keys."""
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


async def test_internal_secret_uses_dedicated_bucket(monkeypatch):
    """ADR-023: a valid x-internal-secret is trusted server-side traffic —
    it counts against the high-capacity internal bucket, not the
    caller's public IP bucket. The pin: the public bucket is exhausted
    yet the internal request passes; a forged secret stays on the IP
    bucket and is refused."""
    import countmein.redis as redis_mod
    import fakeredis.aioredis
    from countmein.auth.internal import INTERNAL_SECRET_HEADER, derived_internal_secret
    from countmein.errors import RateLimited
    from countmein.web.deps import ip_rate_limit

    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setenv("AUTH_SECRET", "ssr-bypass-test-secret")
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    fake = fakeredis.aioredis.FakeRedis()
    monkeypatch.setattr(redis_mod, "client", lambda: fake)

    dep = ip_rate_limit("rl:pub-test:", limit=2, window=60.0)
    ip = "198.51.100.77"

    # Exhaust the public bucket for this IP.
    for _ in range(2):
        await dep(_request({"x-forwarded-for": ip}))
    with pytest.raises(RateLimited):
        await dep(_request({"x-forwarded-for": ip}))

    # The trusted internal request passes — it is not the same bucket.
    good = derived_internal_secret("ssr-bypass-test-secret")
    await dep(_request({"x-forwarded-for": ip, INTERNAL_SECRET_HEADER: good}))

    # A forged secret is not trusted: same public bucket, still full.
    with pytest.raises(RateLimited):
        await dep(_request({"x-forwarded-for": ip, INTERNAL_SECRET_HEADER: "forged"}))


async def test_sliding_window_enforces_limit(monkeypatch):
    """The Lua script against fakeredis: limit 2 per 60s — the third hit
    is refused with a positive retry-after."""
    import fakeredis.aioredis

    fake = fakeredis.aioredis.FakeRedis()
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    import countmein.redis as redis_mod

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
