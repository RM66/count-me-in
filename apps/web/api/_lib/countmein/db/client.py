"""Postgres engine: the server end of the data wire.

Dual-runtime pooling (backend-refactoring-plan Phase 6):

- Vercel serverless (`VERCEL=1`): each function cold start builds its
  own engine; queries take the request context so delivery cancels
  cleanly. NullPool + no server-side prepared statements is safe
  behind a transaction-mode pooler (PgBouncer/Supavisor) and does not
  leak connections across frozen serverless instances.
- Long-running container (`VERCEL` unset — Docker Compose locally,
  ECS / App Runner in prod): a shared AsyncAdaptedQueuePool reuses
  connections across requests, with server-side prepared statements
  enabled (direct Postgres, no transaction-mode pooler in front).

A failed initialization is cached and re-raised on every call, so a
bad URL does not leave the engine None for the lifetime of the
instance — every subsequent request gets a clear "POSTGRES_URL is not
set" instead of a None-deref 500.
"""

from __future__ import annotations

import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import AsyncAdaptedQueuePool, NullPool

_engine: AsyncEngine | None = None
_init_err: Exception | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None
_sessionmaker_engine: AsyncEngine | None = None


def is_serverless() -> bool:
    """True on Vercel serverless (`VERCEL=1`), False in a long-running
    container. The check reads the env on every call so tests can flip
    the mode with monkeypatch without a cache reset."""
    return os.getenv("VERCEL", "0") == "1"


# libpq-known query options are the allowlist: anything else in the URL
# (Supabase pooler strings carry vendor params like `supa=...`) makes
# psycopg fail the connection with "invalid connection option".
_LIBPQ_OPTIONS = frozenset(
    {
        "application_name",
        "connect_timeout",
        "dbname",
        "host",
        "options",
        "passfile",
        "port",
        "sslmode",
        "sslrootcert",
        "target_session_attrs",
        "user",
    }
)


def _sanitize_query(url: str) -> str:
    """Drop query params libpq does not know, keep the rest verbatim."""
    parts = urlsplit(url)
    kept = [
        (k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k in _LIBPQ_OPTIONS
    ]
    return urlunsplit(parts._replace(query=urlencode(kept)))


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
            url = _sanitize_query(url)
            if is_serverless():
                # NullPool explicitly: create_async_engine defaults to
                # AsyncAdaptedQueuePool, which would hold connections
                # open across frozen serverless instances.
                _engine = create_async_engine(
                    url,
                    poolclass=NullPool,
                    connect_args={"prepare_threshold": None, "connect_timeout": 5},
                )
            else:
                # Long-running container: pooled connections across
                # requests; prepared statements stay at the psycopg
                # default threshold (direct Postgres, no
                # transaction-mode pooler in front).
                _engine = create_async_engine(
                    url,
                    poolclass=AsyncAdaptedQueuePool,
                    pool_size=5,
                    max_overflow=10,
                    pool_pre_ping=True,
                    connect_args={"prepare_threshold": 5, "connect_timeout": 10},
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


def sessionmaker() -> async_sessionmaker[AsyncSession]:
    """ORM session factory bound to the shared engine.

    Repositories speak ORM entities (select(Model),
    update(Model).returning(Model)) — only AsyncSession.execute loads
    model instances; AsyncConnection.execute would return raw column
    tuples. expire_on_commit=False: repositories return detached models
    that row mappers read after commit without triggering lazy IO."""
    global _sessionmaker, _sessionmaker_engine
    eng = engine()
    if _sessionmaker is None or _sessionmaker_engine is not eng:
        _sessionmaker = async_sessionmaker(eng, class_=AsyncSession, expire_on_commit=False)
        _sessionmaker_engine = eng
    return _sessionmaker


async def dispose() -> None:
    """Dispose the shared engine if one was opened, then drop the
    cached state so the next engine() call re-reads POSTGRES_URL. The
    lifespan shutdown is the only production caller; a disposal
    failure is the caller's to absorb (it must not mask the response
    already sent)."""
    global _engine, _init_err
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _init_err = None


def reset_for_test() -> None:
    """Drop the cached engine and init state, so the next engine() call
    re-reads POSTGRES_URL (and VERCEL for the pool policy). Test-only.
    Disposal is dispose()'s job; a cached NullPool engine holds no
    connections to close here (a container-mode pool does, but tests
    never open pooled connections — they assert pool policy only)."""
    global _engine, _init_err, _sessionmaker, _sessionmaker_engine
    _engine = None
    _init_err = None
    _sessionmaker = None
    _sessionmaker_engine = None
