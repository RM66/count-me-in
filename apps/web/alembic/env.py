"""Alembic environment: runs apps/web/alembic/versions/* against POSTGRES_URL.

URL handling mirrors api/_lib/countmein/db/client.py (scheme conversion
postgres:// → postgresql+psycopg://, libpq-unknown query params dropped)
but is deliberately duplicated, not imported: migrations must keep
running even if the app code changes around them.

target_metadata points at the SQLAlchemy 2.0 declarative Base.metadata
(countmein.models) so `alembic check` and future autogenerate runs
compare the models against the live schema.
"""

from __future__ import annotations

import asyncio
import os
import sys
from logging.config import fileConfig
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

config = context.config

# disable_existing_loggers=False: env.py also runs in-process via
# alembic_command.upgrade() (tests_py/conftest.py _migrate). The stdlib
# default (True) would disable every pre-existing logger — including
# the countmein singleton in logx.py — killing all app logs after a
# programmatic migration.
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# api/_lib is not on sys.path when alembic runs as a CLI (unlike
# uvicorn/api tests, which set it via pytest pythonpath / index.py).
_HERE = os.path.dirname(os.path.abspath(__file__))
_LIB = os.path.join(_HERE, "..", "api", "_lib")
if os.path.isdir(_LIB):
    _LIB_ABS = os.path.abspath(_LIB)
    if _LIB_ABS not in sys.path:
        sys.path.insert(0, _LIB_ABS)

from countmein.models import Base  # noqa: E402

target_metadata = Base.metadata


def _load_dot_env(path: str) -> None:
    """Fill unset variables from a .env file (minimal parser: KEY=value
    lines with optional surrounding quotes, no interpolation). The real
    environment always wins — mirrors api/index.py."""
    try:
        with open(path, encoding="utf-8") as fh:
            data = fh.read()
    except OSError:
        return
    for line in data.split("\n"):
        line = line.strip()
        if line == "" or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip("\"'")
        if key != "" and os.environ.get(key, "") == "":
            os.environ[key] = value


# Local runs: alembic may start from any cwd, so resolve .env from this
# file's location, not from cwd: first apps/web/.env, then the monorepo
# root .env (Turborepo layouts often keep vars only at the root; today
# apps/web/.env is a symlink to it, so the second load is a no-op —
# kept for when the symlink goes away). _load_dot_env only fills unset
# vars, so the closer file wins.
_base_dir = os.path.dirname(os.path.abspath(__file__))
_load_dot_env(os.path.join(_base_dir, "..", ".env"))
_load_dot_env(os.path.join(_base_dir, "..", "..", "..", ".env"))

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


def _resolve_url() -> str:
    """POSTGRES_URL as a SQLAlchemy URL the psycopg dialect accepts.

    Precedence: an explicitly configured URL (CLI `-x url=...`,
    conftest's set_main_option, or the ini file) wins over the
    environment — otherwise a programmatic caller pointing at a
    per-worker database would silently migrate whatever .env points
    at. Only when nothing is configured does POSTGRES_URL (or the ini
    placeholder, which lets `alembic revision` run without a DB) apply."""
    url = config.get_main_option("sqlalchemy.url", "")
    if url == "" or url.startswith("driver://"):
        url = os.getenv("POSTGRES_URL", "")
        if url == "":
            url = config.get_main_option("sqlalchemy.url", "")
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://") :]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://") :]
    parts = urlsplit(url)
    kept = [
        (k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k in _LIBPQ_OPTIONS
    ]
    return urlunsplit(parts._replace(query=urlencode(kept)))


def run_migrations_offline() -> None:
    context.configure(
        url=_resolve_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Single async engine on NullPool: the migrator must not hold
    connections open across runs (same reason as the app's client.py)."""
    config.set_main_option("sqlalchemy.url", _resolve_url())
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        connect_args={"prepare_threshold": None, "connect_timeout": 5},
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    """Refuse a placeholder URL with a named error: the ini default
    (`driver://...`) exists so offline `alembic revision` runs without a
    DB, but an online command (upgrade/check/current) reaching this point
    with it would die deep inside SQLAlchemy's dialect loader.
    `NoSuchModuleError: sqlalchemy.dialects:driver` names nothing useful."""
    if _resolve_url().startswith("driver://"):
        raise RuntimeError(
            "No database URL: set POSTGRES_URL (env or apps/web/.env). "
            "Only `alembic revision` (no autogenerate) works without one."
        )
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
