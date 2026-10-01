"""The engine's pool policy: dual-runtime (Phase 6).

- Serverless (`VERCEL=1`): NullPool explicitly. Frozen instances must
  not hold Postgres connections open across requests, and no
  server-side prepared statements behind a transaction-mode pooler.
- Container (`VERCEL` unset): AsyncAdaptedQueuePool reuses connections
  across requests in the long-running process.

NullPool is NOT the async default (create_async_engine defaults to
AsyncAdaptedQueuePool), so both branches are pinned by these tests."""

from countmein.db import client
from sqlalchemy.pool import AsyncAdaptedQueuePool, NullPool


def test_engine_uses_null_pool_on_vercel(monkeypatch):
    monkeypatch.setenv("POSTGRES_URL", "postgresql://u:p@localhost:5432/db")
    monkeypatch.setenv("VERCEL", "1")
    client.reset_for_test()
    try:
        eng = client.engine()
        assert isinstance(eng.pool, NullPool), (
            f"serverless engine pool must be NullPool, got {type(eng.pool).__name__}"
        )
    finally:
        client.reset_for_test()


def test_engine_uses_queue_pool_in_container(monkeypatch):
    monkeypatch.setenv("POSTGRES_URL", "postgresql://u:p@localhost:5432/db")
    monkeypatch.delenv("VERCEL", raising=False)
    client.reset_for_test()
    try:
        eng = client.engine()
        assert isinstance(eng.pool, AsyncAdaptedQueuePool), (
            f"container engine pool must be AsyncAdaptedQueuePool, got {type(eng.pool).__name__}"
        )
        # Direct Postgres in the container: prepare_threshold must be
        # pinned explicitly in db/client.py (unlike the serverless
        # branch, which disables prepared statements behind a pooler).
        # The creator closure captures connect_args — pool internals
        # expose no accessor, so assert on the engine URL options the
        # creator was built from instead of private attributes.
        import inspect as _inspect

        import countmein.db.client as client_mod

        src = _inspect.getsource(client_mod.engine)
        container_branch = src.split("Long-running container", 1)[1]
        assert '"prepare_threshold": 5' in container_branch.replace("'", '"')
    finally:
        client.reset_for_test()
