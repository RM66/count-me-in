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

"""

from __future__ import annotations

import os
from typing import Any
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
_sessionmaker: async_sessionmaker[AsyncSession] | None = None
_sessionmaker_engine: AsyncEngine | None = None


def is_serverless() -> bool:
    """True on Vercel serverless (`VERCEL=1`), False in a container.
    Reads env per call so tests can flip the mode via monkeypatch."""
    return os.getenv("VERCEL", "0") == "1"


# Allowlist of libpq-known query options: anything else in the URL
# (Supabase pooler strings carry `supa=...` etc.) makes psycopg fail
# with "invalid connection option".
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


# Server-side cap on any single statement (ADR-024): a runaway query
# must not hold a connection — on serverless, the maxDuration —
# hostage. `options` rides on every connection of both pool policies.
STATEMENT_TIMEOUT_MS = 8000

_SERVERLESS_CONNECT_ARGS: dict[str, Any] = {
    "prepare_threshold": None,
    "connect_timeout": 5,
}
_CONTAINER_CONNECT_ARGS: dict[str, Any] = {
    "prepare_threshold": 5,
    "connect_timeout": 10,
}


def _connect_args(base: dict[str, Any], url: str) -> dict[str, Any]:
    """base args + `options=-c statement_timeout=…`. A libpq `options`
    already in the URL is preserved — connect kwargs win over URL params
    on a duplicate key, so an unmerged options= would drop it."""
    url_options = dict(parse_qsl(urlsplit(url).query)).get("options", "")
    merged = f"{url_options} -c statement_timeout={STATEMENT_TIMEOUT_MS}".strip()
    return {**base, "options": merged}


def engine() -> AsyncEngine:
    """Lazily open the shared engine. No lock: no await in the body, so
    it is atomic w.r.t. the event loop."""
    global _engine
    if _engine is None:
        url = os.getenv("POSTGRES_URL", "")
        if url == "":
            raise RuntimeError("POSTGRES_URL is not set")
        if url.startswith("postgres://"):
            url = "postgresql+psycopg://" + url[len("postgres://") :]
        elif url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://") :]
        url = _sanitize_query(url)
        if is_serverless():
            # NullPool explicitly: the default QueuePool would hold
            # connections open across frozen serverless instances.
            _engine = create_async_engine(
                url,
                poolclass=NullPool,
                connect_args=_connect_args(_SERVERLESS_CONNECT_ARGS, url),
            )
        else:
            # Long-running container: pooled connections; prepared
            # statements at the psycopg threshold (direct Postgres,
            # no transaction-mode pooler in front).
            _engine = create_async_engine(
                url,
                poolclass=AsyncAdaptedQueuePool,
                pool_size=5,
                max_overflow=10,
                pool_pre_ping=True,
                connect_args=_connect_args(_CONTAINER_CONNECT_ARGS, url),
            )
    return _engine


async def ping() -> None:
    """Probe connectivity (healthz)."""
    async with engine().connect() as conn:
        await conn.execute(text("SELECT 1"))


def sessionmaker_for(eng: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """A session factory bound to a specific engine — the request-time
    factory behind web.deps.get_db_session (the app.state override
    path) and the test seam."""
    return async_sessionmaker(eng, class_=AsyncSession, expire_on_commit=False)


def sessionmaker() -> async_sessionmaker[AsyncSession]:
    """ORM session factory bound to the shared engine.

    Repositories speak ORM entities (select(Model), returning(Model)) —
    only AsyncSession.execute loads model instances; a raw connection
    returns column tuples. expire_on_commit=False: repositories return
    detached models that row mappers read without lazy IO. Worker entry
    points (jobs, seed, media cleanup) own sessions via this factory;
    request handlers use web.deps.get_db_session."""
    global _sessionmaker, _sessionmaker_engine
    eng = engine()
    if _sessionmaker is None or _sessionmaker_engine is not eng:
        _sessionmaker = sessionmaker_for(eng)
        _sessionmaker_engine = eng
    return _sessionmaker


async def dispose() -> None:
    """Dispose the shared engine if opened, then drop cached state so
    the next engine() re-reads POSTGRES_URL. The lifespan shutdown is
    the only production caller; a disposal failure is the caller's to
    absorb (it must not mask a sent response)."""
    global _engine
    if _engine is not None:
        await _engine.dispose()
    _engine = None


def reset_for_test() -> None:
    """Drop the cached engine so the next engine() re-reads POSTGRES_URL
    (and VERCEL for the pool policy). Test-only; disposal is dispose()'s
    job — a cached NullPool engine holds no connections (tests never
    open pooled ones — they assert pool policy only)."""
    global _engine, _sessionmaker, _sessionmaker_engine
    _engine = None
    _sessionmaker = None
    _sessionmaker_engine = None
