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

import httpx

_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    """The shared async client. Default timeout is generous (10s);
    callers with a hard deadline pass their own `timeout=` per request."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(10.0))
    return _client


def reset_for_test() -> None:
    """Drop the client so the next call rebuilds it (test-only). The
    client is not closed here — the lifespan shutdown owns closing;
    a fresh client is built regardless."""
    global _client
    _client = None
