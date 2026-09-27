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

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool

_engine: AsyncEngine | None = None
_init_err: Exception | None = None


def engine() -> AsyncEngine:
    """Lazily open the shared engine. No lock: the body has no await, so
    it is atomic with respect to the event loop."""
    global _engine, _init_err
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
                # NullPool explicitly: create_async_engine defaults to
                # AsyncAdaptedQueuePool, which would hold connections
                # open across frozen serverless instances.
                poolclass=NullPool,
                connect_args={"prepare_threshold": None, "connect_timeout": 5},
            )
    if _init_err is not None:
        raise _init_err
    if _engine is None:
        # Unreachable by the decode/guard contract; a real None
        # here is a bug, and python -O must not strip the check.
        raise RuntimeError("_engine is None after its error guard")
    return _engine


async def ping() -> None:
    """Probe connectivity (healthz)."""
    async with engine().connect() as conn:
        await conn.execute(text("SELECT 1"))


def reset_for_test() -> None:
    """Drop the cached engine and init state, so the next engine() call
    re-reads POSTGRES_URL. Test-only. Disposal is the lifespan's job;
    NullPool holds no connections to close here."""
    global _engine, _init_err
    _engine = None
    _init_err = None
