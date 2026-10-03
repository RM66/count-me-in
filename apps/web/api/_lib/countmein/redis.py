"""Shared Redis connection. Key names and payload shapes are contracts
(login-link key prefix in contracts/constants_gen), mirroring
@repo/contracts and the TS server singleton (src/server/redis.ts).
"""

from __future__ import annotations

import asyncio
import os
from typing import TYPE_CHECKING


def _running_loop() -> asyncio.AbstractEventLoop | None:
    """The running loop, or None outside one — client() may be called
    from sync code (tests), where there is nothing to bind to."""
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return None


if TYPE_CHECKING:
    import redis.asyncio as aioredis

_client: aioredis.Redis | None = None
_init_err: Exception | None = None
# The loop the cached client was created on. Serverless may serve a
# later invocation on a new loop; a client bound to the old one fails
# with "attached to a different loop". Rebuilt instead — from_url opens
# no sockets, so it is cheap.
_client_loop: asyncio.AbstractEventLoop | None = None


def client() -> aioredis.Redis:
    """Return the shared connection, opened on first use — a missing
    REDIS_URL surfaces at the call site, not at import time.

    A failed initialization is cached and re-raised on every call, so a
    bad URL leaves no None client — every request gets "REDIS_URL is
    not set" instead of a None-deref 500. No lock: no await in the body.
    """
    global _client, _init_err, _client_loop
    # Imported lazily: the cold-start rules (tests_py/test_cold_imports)
    # forbid pulling the asyncio client machinery into a bare app import.
    import redis.asyncio as aioredis
    from redis import backoff as redis_backoff
    from redis import retry as redis_retry

    loop = _running_loop()
    if _client is not None and loop is not None and _client_loop is not loop:
        # New loop since the client was built (serverless reuse): drop
        # and rebuild on this loop. aclose() on the old loop's client is
        # unsafe from here — the old connection is left to pool timeouts
        # / process teardown.
        _client = None
    if _client is None and _init_err is None:
        url = os.getenv("REDIS_URL", "")
        if url == "":
            _init_err = RuntimeError("REDIS_URL is not set")
        else:
            # Mirrors the TS server singleton (src/server/redis.ts):
            # maxRetriesPerRequest 2.
            _client = aioredis.from_url(
                url,
                retry_on_timeout=True,
                retry=redis_retry.Retry(redis_backoff.ExponentialBackoff(), 2),
            )
            _client_loop = loop
    if _init_err is not None:
        raise _init_err
    if _client is None:
        # Unreachable by contract; a real None is a bug — a raise, not
        # an assert, so python -O cannot strip the check.
        raise RuntimeError("_client is None after its error guard")
    return _client


async def dispose() -> None:
    """Close the shared connection if opened, then drop cached state so
    the next client() re-reads REDIS_URL. The lifespan shutdown is the
    only production caller; a close failure is the caller's to absorb
    (it must not mask a sent response)."""
    global _client, _init_err, _client_loop
    if _client is not None:
        await _client.aclose()
    _client = None
    _init_err = None
    _client_loop = None


def reset_for_test() -> None:
    """Drop the cached client so the next client() re-reads REDIS_URL.
    Test-only — the singleton is process-wide. Closing the connection
    is dispose()'s job, not a fire-and-forget coroutine here."""
    global _client, _init_err, _client_loop
    _client = None
    _init_err = None
    _client_loop = None
