"""The app.state override seam for the shared clients (ADR-021 follow-up).

get_db_engine / get_redis resolve `app.state.db_engine` /
`app.state.redis_client` when set — the per-app override that lets a
test (or an embedding) swap the engine/Redis without touching the
process-wide singletons, keeping parallel test runs isolated. The
fallback is the documented lazy singleton.
"""

from __future__ import annotations

import pytest
from countmein.web.deps import get_db_engine, get_redis


class _FakeState:
    def __init__(self) -> None:
        self.db_engine = None
        self.redis_client = None


class _FakeApp:
    def __init__(self) -> None:
        self.state = _FakeState()


class _FakeRequest:
    def __init__(self, app: _FakeApp) -> None:
        self.app = app


def test_db_engine_override_wins() -> None:
    """app.state.db_engine short-circuits the process singleton."""
    sentinel = object()
    app = _FakeApp()
    app.state.db_engine = sentinel
    assert get_db_engine(_FakeRequest(app)) is sentinel


def test_redis_override_wins() -> None:
    """app.state.redis_client short-circuits the process singleton."""
    sentinel = object()
    app = _FakeApp()
    app.state.redis_client = sentinel
    assert get_redis(_FakeRequest(app)) is sentinel


def test_no_override_falls_back_to_singleton(monkeypatch: pytest.MonkeyPatch) -> None:
    """Without an override the lazy singleton is used (and its missing
    env surfaces at the call site, as documented)."""
    monkeypatch.delenv("POSTGRES_URL", raising=False)
    from countmein.db import client as db_client

    db_client.reset_for_test()
    with pytest.raises(RuntimeError, match="POSTGRES_URL is not set"):
        get_db_engine(_FakeRequest(_FakeApp()))
    db_client.reset_for_test()
