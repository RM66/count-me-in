"""The shared lazy `httpx.AsyncClient` for outbound HTTP (QStash
publish, Telegram sendMessage).

One client per process, created lazily on first use (never at import —
the cold-start rule, tests_py/test_cold_imports.py). Constructing an
AsyncClient opens no sockets, so laziness here is about import cost,
not network. Timeouts are set on the client so every call inherits them;
callers may still pass a tighter per-request timeout.

Tests never touch the network: they patch the transport seams in
`queue._post` / `jobs.telegram._post`."""

from __future__ import annotations

import asyncio

import httpx


def _running_loop() -> asyncio.AbstractEventLoop | None:
    """The running loop, or None outside one — client() may be called
    from sync code (tests); without a loop there is nothing to be
    bound to, so the affinity check is skipped."""
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return None


_client: httpx.AsyncClient | None = None
# The loop the cached client was created on — see redis.py for why the
# client is rebuilt when the running loop changes (serverless reuse can
# serve a later invocation on a fresh event loop).
_client_loop: asyncio.AbstractEventLoop | None = None


def client() -> httpx.AsyncClient:
    """The shared async client. Default timeout is generous (10s);
    callers with a hard deadline pass their own `timeout=` per request."""
    global _client, _client_loop
    loop = _running_loop()
    if _client is not None and loop is not None and _client_loop is not loop:
        # New event loop since the client was built: rebuild on this
        # loop. aclose() on the old loop's client is unsafe from here;
        # the old client is left to process teardown.
        _client = None
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(10.0))
        _client_loop = loop
    return _client


async def dispose() -> None:
    """Close the shared client if one was opened, then drop the
    reference so the next call rebuilds it. The lifespan shutdown is
    the only production caller; a close failure is the caller's to
    absorb (it must not mask the response already sent)."""
    global _client, _client_loop
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None
    _client_loop = None


def reset_for_test() -> None:
    """Drop the client so the next call rebuilds it (test-only). The
    client is not closed here — dispose() owns closing; a fresh
    client is built regardless."""
    global _client, _client_loop
    _client = None
    _client_loop = None
