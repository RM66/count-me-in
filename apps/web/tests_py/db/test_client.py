"""The engine's pool policy: NullPool, explicitly.

Serverless instances freeze between requests; a queue pool would hold
Postgres connections open across frozen instances and leak them behind
a transaction-mode pooler. The engine must therefore use NullPool —
which is NOT the async default (create_async_engine defaults to
AsyncAdaptedQueuePool), so the choice is pinned by this test."""

from countmein.db import client
from sqlalchemy.pool import NullPool


def test_engine_uses_null_pool(monkeypatch):
    monkeypatch.setenv("POSTGRES_URL", "postgresql://u:p@localhost:5432/db")
    client.reset_for_test()
    try:
        eng = client.engine()
        assert isinstance(eng.pool, NullPool), (
            f"engine pool must be NullPool, got {type(eng.pool).__name__}"
        )
    finally:
        client.reset_for_test()
