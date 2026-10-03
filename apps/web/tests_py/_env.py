"""Shared env gating for integration tests.

One rule, used by every Postgres/Redis-backed test: locally (no CI) a
missing service skips the test — the developer may not have docker
running. Under CI the same missing service FAILS instead: a
misconfigured CI service would otherwise go green with zero integration
coverage.

Importable as `from _env import require_postgres` — pytest puts this
directory on sys.path via tests_py/conftest.py.
"""

from __future__ import annotations

import os

import pytest


def _require_env(name: str) -> str:
    url = os.getenv(name, "")
    if url != "":
        return url
    if os.getenv("CI", "") == "true":
        pytest.fail(
            f"{name} is not set — CI must run integration tests, not skip them "
            "(check the CI service wiring)"
        )
    pytest.skip(f"{name} is not set — start the docker services to run integration tests")


def require_postgres() -> str:
    """POSTGRES_URL, or skip locally / fail in CI when missing."""
    return _require_env("POSTGRES_URL")


def require_redis() -> str:
    """REDIS_URL, or skip locally / fail in CI when missing."""
    return _require_env("REDIS_URL")


def skip_or_fail_ci(reason: str) -> None:
    """Skip locally, fail under CI — for gates that check more than env
    (e.g. service reachability): the reason names what is missing."""
    if os.getenv("CI", "") == "true":
        pytest.fail(f"{reason} — CI service misconfigured, refusing silent skip")
    pytest.skip(reason)
