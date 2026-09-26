"""Postgres engine: the server end of the data wire.

Serverless: each function cold start builds its own small pool; queries
take the request context so delivery cancels cleanly. NullPool + no
server-side prepared statements is safe behind a transaction-mode pooler
(PgBouncer/Supavisor) and does not leak connections across frozen
serverless instances.

A failed initialization is cached and re-raised on every call, so a
bad URL does not leave the engine None for the lifetime of the
instance — every subsequent request gets a clear "POSTGRES_URL is not
set" instead of a None-deref 500.
"""

from __future__ import annotations

import os
import threading

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

_engine: AsyncEngine | None = None
_init_err: Exception | None = None
_lock = threading.Lock()


def engine() -> AsyncEngine:
    """Lazily open the shared engine."""
    global _engine, _init_err
    with _lock:
        if _engine is None and _init_err is None:
            url = os.getenv("POSTGRES_URL", "")
            if url == "":
                _init_err = RuntimeError("POSTGRES_URL is not set")
            else:
                if url.startswith("postgres://"):
                    url = "postgresql+psycopg://" + url[len("postgres://") :]
                elif url.startswith("postgresql://"):
                    url = "postgresql+psycopg://" + url[len("postgresql://") :]
                _engine = create_async_engine(
                    url,
                    poolclass=None,  # NullPool is the default for async engines
                    connect_args={"prepare_threshold": None, "connect_timeout": 5},
                )
        if _init_err is not None:
            raise _init_err
        assert _engine is not None
        return _engine


async def ping() -> None:
    """Probe connectivity (healthz)."""
    async with engine().connect() as conn:
        await conn.execute(text("SELECT 1"))


def reset_for_test() -> None:
    """Drop the cached engine so the next engine() call re-reads
    POSTGRES_URL. Test-only."""
    global _engine, _init_err
    with _lock:
        if _engine is not None:
            try:
                import asyncio

                asyncio.get_event_loop().run_until_complete(_engine.dispose())
            except Exception:
                pass
        _engine = None
        _init_err = None
