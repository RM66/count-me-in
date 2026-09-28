"""Event-loop affinity of the cached async clients (ADR-021 follow-up).

A serverless runtime may reuse a warm process but serve a later
invocation on a *new* event loop (ASGI context reset). A Redis or
httpx client bound to the old loop then fails every command with
"attached to a different loop". The lazy singletons must detect the
loop change and rebuild the client on the current loop.

A real second loop cannot run inside pytest-asyncio's loop, so the
change is simulated by pointing _client_loop at a stale loop object —
exactly the state a warm instance wakes up in.
"""

from __future__ import annotations

import asyncio

import httpx
import pytest
from _lib.countmein import redis as redis_mod
from _lib.countmein.web import async_client


@pytest.fixture(autouse=True)
def _reset_clients():
    yield
    redis_mod.reset_for_test()
    async_client.reset_for_test()


async def test_redis_client_rebuilds_on_loop_change(monkeypatch: pytest.MonkeyPatch) -> None:
    """A client cached on a stale loop is rebuilt on the current one."""
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/15")
    first = redis_mod.client()
    assert redis_mod._client_loop is asyncio.get_running_loop()

    # Simulate the warm instance waking up on a new loop.
    stale = asyncio.new_event_loop()
    try:
        redis_mod._client_loop = stale
        second = redis_mod.client()
        assert second is not first
        assert redis_mod._client_loop is asyncio.get_running_loop()
    finally:
        stale.close()


async def test_httpx_client_rebuilds_on_loop_change() -> None:
    """The shared httpx client follows the same rule."""
    first = async_client.client()
    assert async_client._client_loop is asyncio.get_running_loop()

    stale = asyncio.new_event_loop()
    try:
        async_client._client_loop = stale
        second = async_client.client()
        assert second is not first
        assert isinstance(second, httpx.AsyncClient)
        assert async_client._client_loop is asyncio.get_running_loop()
    finally:
        stale.close()


async def test_same_loop_reuses_client() -> None:
    """No loop change → the cached client is returned as-is."""
    assert async_client.client() is async_client.client()
