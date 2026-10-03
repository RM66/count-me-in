"""Shared pytest fixtures.

pg_url / redis_url: integration tests need the docker-compose Postgres
and Redis. The skip/fail rule itself lives in tests_py/_env.py (plain
functions, usable from pytestmark and module scope where fixtures
cannot reach).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# importlib import mode does not put this directory on sys.path; the
# shared _env helpers are imported as plain modules from here on.
sys.path.insert(0, str(Path(__file__).parent))

import pytest
from _env import require_postgres, require_redis
from dotenv import load_dotenv

# Without POSTGRES_URL the xdist isolation below is a no-op and parity
# workers collide on one shared database. Never override what the
# environment (CI) already sets. Walk up to the first .env (repo root
# locally; absent in CI).
_env_file = next(
    (p / ".env" for p in Path(__file__).resolve().parents if (p / ".env").is_file()),
    None,
)
if _env_file is not None:
    load_dotenv(_env_file, override=False)


@pytest.fixture(scope="session", autouse=True)
def _xdist_isolation():
    """Per-worker isolation under pytest-xdist (`-n auto`).

    The suite shares one Postgres and one Redis, but the parity replay
    TRUNCATEs every table and FLUSHDBs — under xdist that collides with
    other workers' DML (deadlocks) and wipes their Redis state. Each
    worker gets its own slice, created once per worker process:

    - Postgres: a per-worker database, migrated with Alembic
      (`alembic upgrade head`). Not a TEMPLATE clone — the clone needs
      zero other connections to the base, which a dev server violates.
    - Redis: a per-worker logical database (db index = worker id + 1;
      db 0 stays untouched for the dev topology).

    Without xdist the fixture is a no-op and the base URL is used as-is.
    """
    worker = os.getenv("PYTEST_XDIST_WORKER", "")
    if worker == "":
        yield
        return

    base_pg = os.getenv("POSTGRES_URL", "")
    if base_pg != "":
        import psycopg

        dbname = f"countmein_test_{worker}"
        # Admin statements run from the neutral `postgres` maintenance
        # database — DROP DATABASE cannot run on the database itself.
        admin_url = _replace_dbname(base_pg, "postgres")
        with psycopg.connect(admin_url, autocommit=True) as conn:
            # Always recreate: a leftover database may carry a schema
            # older than the migrations.
            conn.execute(f'DROP DATABASE IF EXISTS "{dbname}" WITH (FORCE)')
            conn.execute(f'CREATE DATABASE "{dbname}"')
        _migrate(_replace_dbname(base_pg, dbname))
        os.environ["POSTGRES_URL"] = _replace_dbname(base_pg, dbname)

    base_redis = os.getenv("REDIS_URL", "")
    if base_redis != "":
        # Worker gw0 → db 1, gw1 → db 2, …; db 0 is left alone.
        index = int(worker.removeprefix("gw")) + 1
        os.environ["REDIS_URL"] = f"{base_redis.rstrip('/')}/{index}"

    yield


def _replace_dbname(url: str, dbname: str) -> str:
    """Swap the database name in a postgres://…/name URL (query string
    preserved)."""
    from urllib.parse import urlsplit, urlunsplit

    parts = urlsplit(url)
    path = "/" + dbname
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))


def _migrate(url: str) -> None:
    """Migrate the fresh per-worker database with Alembic, then seed the
    demo organizer — several tests hang booking chains off
    DEMO_ORGANIZER_ID and rely on the row existing. The database is
    recreated every run, so there is no state to track."""
    from datetime import UTC, datetime

    from alembic.config import Config as AlembicConfig

    from alembic import command as alembic_command

    web_root = Path(__file__).resolve().parents[1]
    cfg = AlembicConfig(str(web_root / "alembic.ini"))
    cfg.set_main_option("script_location", str(web_root / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url)
    alembic_command.upgrade(cfg, "head")

    import asyncio

    from countmein.db.seed import seed_demo

    os.environ["POSTGRES_URL"] = url
    asyncio.run(seed_demo(datetime.now(UTC)))


@pytest.fixture()
def pg_url() -> str:
    """POSTGRES_URL, or skip locally / fail in CI when missing."""
    return require_postgres()


@pytest.fixture()
def redis_url() -> str:
    """REDIS_URL, or skip locally / fail in CI when missing."""
    return require_redis()


# `_require_postgres` is autouse, so its name is in every test's
# fixturenames and cannot be the signal. The signal is the opt-in
# `usefixtures("_require_postgres")` marker plus the live-service
# fixtures below.
_INTEGRATION_FIXTURES = {"pg_url", "redis_url", "db"}


def pytest_collection_modifyitems(config, items):
    """Auto-mark integration tests: any test that pulls a live-service
    fixture or calls the _env gates gets `integration`, so
    `uv run pytest -m 'not integration'` runs the pure unit suite. The
    signal is structural (fixture/marker use), not a hand-maintained
    per-module list."""
    for item in items:
        fixturenames = set(getattr(item, "fixturenames", ()))
        uses_gate = any(
            "_require_postgres" in marker.args for marker in item.iter_markers("usefixtures")
        )
        if fixturenames & _INTEGRATION_FIXTURES or uses_gate:
            item.add_marker(pytest.mark.integration)
        else:
            item.add_marker(pytest.mark.unit)


@pytest.fixture(autouse=True)
def _require_postgres(request):
    """The shared Postgres gate. Opt a module in with
    `pytestmark = pytest.mark.usefixtures("_require_postgres")` — the
    usefixtures mark triggers the check (autouse means the fixture name
    is in every test's fixturenames and cannot be the signal). Modules
    that never opt in run without Postgres."""
    for marker in request.node.iter_markers("usefixtures"):
        if "_require_postgres" in marker.args:
            require_postgres()
            return
