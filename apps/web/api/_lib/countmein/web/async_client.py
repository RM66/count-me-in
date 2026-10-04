"""The shared lazy `httpx.AsyncClient` for outbound HTTP (QStash
publish, Telegram sendMessage).

One client per process, created lazily on first use (never at import —
the cold-start rule, tests_py/test_cold_imports.py). Constructing an
AsyncClient opens no sockets, so laziness here is about import cost,
not network. Timeouts are set on the client so every call inherits them;
callers may still pass a tighter per-request timeout.

Tests never touch the network: they mock the transport with respx —
interception happens inside httpx, so no module-level seam is needed."""

from __future__ import annotations

import asyncio

import httpx


def _running_loop() -> asyncio.AbstractEventLoop | None:
    """The running loop, or None outside one — client() may be called
    from sync code (tests), where there is nothing to bind to."""
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return None


_client: httpx.AsyncClient | None = None
# The loop the cached client was created on — see redis.py: serverless
# reuse can serve a later invocation on a fresh loop.
_client_loop: asyncio.AbstractEventLoop | None = None


def client() -> httpx.AsyncClient:
    """The shared async client. Default timeout is generous (10s);
    callers with a hard deadline pass their own `timeout=` per request."""
    global _client, _client_loop
    loop = _running_loop()
    if _client is not None and loop is not None and _client_loop is not loop:
        # New loop since the client was built: rebuild on this one.
        # aclose() on the old loop's client is unsafe from here — left
        # to process teardown.
        _client = None
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(10.0))
        _client_loop = loop
    return _client


async def dispose() -> None:
    """Close the shared client if opened, then drop the reference.
    The lifespan shutdown is the only production caller; a close
    failure is the caller's to absorb (it must not mask a sent
    response)."""
    global _client, _client_loop
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None
    _client_loop = None


def reset_for_test() -> None:
    """Drop the client so the next call rebuilds it (test-only).
    Not closed here — dispose() owns closing."""
    global _client, _client_loop
    _client = None
    _client_loop = None
