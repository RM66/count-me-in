"""The healthz tests — the probe's own
recovery: a panicking (or env-missing) dependency answers a JSON 503
naming the missing variables, a healthy one answers 200. The probes are
module-level seams so the recovery path is pinned without initializing
the process-wide pools."""

from __future__ import annotations

import json
import logging

import pytest
from countmein import redis as redis_mod
from countmein.routes import healthz


def make_request():
    from starlette.requests import Request

    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/healthz",
        "raw_path": b"/api/healthz",
        "headers": [],
        "query_string": b"",
        "client": ("127.0.0.1", 12345),
        "scheme": "http",
        "server": ("testserver", 80),
        "http_version": "1.1",
    }
    return Request(scope)


@pytest.fixture(autouse=True)
def _no_rate_limit(monkeypatch):
    """No REDIS_URL → the healthz limiter fails open, every request
    reaches the probe (the tests exercise the probe, not the bucket)."""
    monkeypatch.setenv("REDIS_URL", "")


async def _call(monkeypatch, probe_pg, probe_redis=None):
    async def fake_pg():
        raise RuntimeError("POSTGRES_URL is not set")

    monkeypatch.setattr(healthz, "_probe_postgres", probe_pg or fake_pg)
    if probe_redis is not None:
        monkeypatch.setattr(healthz, "_probe_redis", probe_redis)
    return await healthz.handle_healthz(make_request())


async def test_healthz_probe_panic_answers_503_with_missing_env(monkeypatch):
    """A panicking probe must answer a JSON 503 whose body names the
    missing env variables and carries the panic text — not a connection
    reset with a runtime stack in the log. The panic is also logged
    (healthz is excluded from the access log, so the
    explicit line is the only trace a misconfigured deploy leaves)."""

    async def panic():
        raise RuntimeError("POSTGRES_URL is not set")

    records: list[object] = []

    class _Sink(logging.Handler):
        def emit(self, record):
            records.append(record)

    logger = logging.getLogger("countmein")
    sink = _Sink(level=logging.DEBUG)
    logger.addHandler(sink)
    try:
        monkeypatch.setenv("POSTGRES_URL", "")
        monkeypatch.setenv("REDIS_URL", "")
        response = await _call(monkeypatch, panic)
    finally:
        logger.removeHandler(sink)
    assert response.status_code == 503, "panicking probe must answer 503"
    assert response.headers["content-type"].startswith("application/json")
    body = json.loads(response.body)
    assert body["postgres"] == "fail"
    assert body["redis"] == "fail"
    assert "POSTGRES_URL" in body["missingEnv"], "missingEnv must name POSTGRES_URL"
    assert "POSTGRES_URL is not set" in body["error"], "error must carry the panic text"
    panics = [r for r in records if r.levelname == "ERROR" and "healthz panic" in r.getMessage()]
    assert panics, "the panic path must log an ERROR line"


async def test_healthz_probe_failure_answers_503(monkeypatch):
    """A failing (non-panicking) probe is still a 503 with the failed
    dependency marked — the recovery distinguishes nothing, the body
    reports the fact."""

    async def fail():
        raise ConnectionError("connection refused")

    monkeypatch.setenv("POSTGRES_URL", "")
    monkeypatch.setenv("REDIS_URL", "")
    response = await _call(monkeypatch, fail)
    assert response.status_code == 503
    body = json.loads(response.body)
    assert body["postgres"] == "fail"


async def test_healthz_healthy_answers_200(monkeypatch):
    """Both probes green → 200 with both dependencies ok. The probes
    are stubbed: the point is the wiring (status, body shape), not the
    dependencies themselves."""

    async def ok():
        return None

    monkeypatch.setenv("POSTGRES_URL", "postgresql://test")
    monkeypatch.setenv("REDIS_URL", "redis://test")
    response = await _call(monkeypatch, ok, ok)
    assert response.status_code == 200
    body = json.loads(response.body)
    assert body == {"postgres": "ok", "redis": "ok"}


async def test_healthz_redis_unconfigured_is_skipped(monkeypatch):
    """Without REDIS_URL the redis check reports `skipped`, not `fail`:
    an optional dependency being absent is not an outage."""

    async def ok():
        return None

    monkeypatch.setenv("POSTGRES_URL", "postgresql://test")
    monkeypatch.setenv("REDIS_URL", "")
    response = await _call(monkeypatch, ok)
    assert response.status_code == 200
    body = json.loads(response.body)
    assert body["redis"] == "skipped"


async def test_healthz_rate_limited(monkeypatch):
    """30/min per IP: the 31st probe inside the window is a 429 — the
    probe is unauthenticated and each call burns a connection from the
    small serverless pool. The bucket is a route-level Depends now, so
    the test goes through the app (the only faithful way to run the
    dependency chain)."""
    import fakeredis.aioredis
    import httpx

    fake = fakeredis.aioredis.FakeRedis()
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(redis_mod, "client", lambda: fake)

    async def ok():
        return None

    monkeypatch.setenv("POSTGRES_URL", "postgresql://test")
    monkeypatch.setattr(healthz, "_probe_postgres", ok)
    monkeypatch.setattr(healthz, "_probe_redis", ok)

    from countmein.app import create_app

    app = create_app()
    transport = httpx.ASGITransport(app=app)
    statuses = []
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        for _ in range(31):
            response = await c.get("/api/healthz")
            statuses.append(response.status_code)
    assert statuses[:30] == [200] * 30
    assert statuses[30] == 429, "the 31st probe inside the window must be a 429"
    assert "Retry-After" in response.headers, "the 429 must carry Retry-After"
