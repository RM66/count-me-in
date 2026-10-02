"""Shared fixtures for the route tests.

The handlers' preamble is a set of FastAPI dependencies, so the app is
the only faithful way to invoke them. Redis-backed state (rate buckets,
tickets) runs against fakeredis; DB-backed happy paths run against the
docker Postgres (skipped without POSTGRES_URL, failed in CI — the
conftest rule).
"""

from __future__ import annotations

import httpx
import pytest
from countmein import redis as redis_mod

TEST_SECRET = "route-test-golden-secret"
BASE = "http://testserver"


@pytest.fixture()
async def fake_redis(monkeypatch):
    import fakeredis.aioredis

    fake = fakeredis.aioredis.FakeRedis()
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(redis_mod, "client", lambda: fake)
    yield fake
    await fake.aclose()


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("AUTH_SECRET", TEST_SECRET)


@pytest.fixture()
async def app(fake_redis):
    from countmein.app import create_app

    yield create_app()


@pytest.fixture()
async def client(app):
    """Every response from a spec-declared operation is validated against
    the bundled spec (ADR-024 B3) — serializer drift fails the test that
    produced it."""
    from _spec_check import ContractClient

    transport = httpx.ASGITransport(app=app)
    async with ContractClient(transport=transport, base_url=BASE, timeout=30.0) as c:
        yield c


# ── DB-backed helpers (need Postgres) ─────────────────────────────────────────


@pytest.fixture()
async def db(monkeypatch):
    """A live Postgres for the happy paths — the shared skip/fail rule
    (tests_py/_env.py): without POSTGRES_URL the test skips locally and
    fails in CI, instead of erroring on a hardcoded localhost."""
    from _env import require_postgres

    url = require_postgres()
    from countmein.db import client as db_client

    monkeypatch.setenv("POSTGRES_URL", url)
    db_client.reset_for_test()
    yield db_client
    db_client.reset_for_test()
