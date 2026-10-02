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
        # Direct Postgres in the container: prepared statements stay on
        # (unlike the serverless branch, which disables them behind a
        # transaction-mode pooler).
        assert client._CONTAINER_CONNECT_ARGS["prepare_threshold"] == 5
    finally:
        client.reset_for_test()


def test_statement_timeout_on_both_pool_policies():
    """ADR-024: every connection — pooled container or per-request
    serverless — carries a server-side statement_timeout, so a runaway
    query cannot hold a connection (or the function's maxDuration)."""
    url = "postgresql://u:p@localhost:5432/db"
    for base in (client._SERVERLESS_CONNECT_ARGS, client._CONTAINER_CONNECT_ARGS):
        args = client._connect_args(base, url)
        assert args["options"] == f"-c statement_timeout={client.STATEMENT_TIMEOUT_MS}"
        assert client.STATEMENT_TIMEOUT_MS > 0


def test_statement_timeout_merges_with_url_options():
    """A libpq `options` already in POSTGRES_URL is preserved — psycopg
    connect kwargs win over URL params on a duplicate key, so without
    the merge the caller's options= would be silently dropped."""
    url = "postgresql://u:p@localhost:5432/db?options=-c%20search_path%3Dapp"
    args = client._connect_args(client._SERVERLESS_CONNECT_ARGS, url)
    assert "search_path=app" in args["options"]
    assert f"statement_timeout={client.STATEMENT_TIMEOUT_MS}" in args["options"]
