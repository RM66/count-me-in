"""Shared pytest fixtures.

pg_url / redis_url: integration tests need the docker-compose Postgres
and Redis. The skip/fail rule itself lives in tests_py/_env.py (plain
functions, usable from pytestmark and module scope where fixtures
cannot reach).
"""

from __future__ import annotations

import sys
from pathlib import Path

# importlib import mode does not put this directory on sys.path; the
# shared _env helpers are imported as plain modules from here on.
sys.path.insert(0, str(Path(__file__).parent))

import pytest
from _env import require_postgres, require_redis


@pytest.fixture()
def pg_url() -> str:
    """POSTGRES_URL, or skip locally / fail in CI when missing."""
    return require_postgres()


@pytest.fixture()
def redis_url() -> str:
    """REDIS_URL, or skip locally / fail in CI when missing."""
    return require_redis()


@pytest.fixture(autouse=True)
def _require_postgres(request):
    """The shared Postgres gate. Opt a whole module in with
    `pytestmark = pytest.mark.usefixtures("_require_postgres")` —
    pytest then lists the fixture in every test's fixturenames, which
    is what triggers the check. Unit-test modules never opt in, so
    they pass through untouched."""
    if "_require_postgres" in request.fixturenames:
        require_postgres()
