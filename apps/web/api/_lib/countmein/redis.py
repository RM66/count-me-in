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
    from sync code (tests); without a loop there is nothing to be
    bound to, so the affinity check is skipped."""
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return None


if TYPE_CHECKING:
    import redis.asyncio as aioredis

_client: aioredis.Redis | None = None
_init_err: Exception | None = None
# The loop the cached client was created on. A serverless runtime may
# serve a later invocation on a new event loop; a client bound to the
# old loop fails every command with "attached to a different loop".
# Rebuilt instead — from_url opens no sockets, so the rebuild is cheap.
_client_loop: asyncio.AbstractEventLoop | None = None


def client() -> aioredis.Redis:
    """Return the shared connection, opened on first use — a missing
    REDIS_URL surfaces at the call site rather than at import time.

    A failed initialization is cached and re-raised on every call, so a
    bad URL does not leave the client None for the lifetime of the
    instance — every subsequent request gets a clear "REDIS_URL is not
    set" instead of a None-deref 500. No lock: the body has no await, so
    it is atomic with respect to the event loop.
    """
    global _client, _init_err, _client_loop
    # Imported lazily: the cold-start rules (tests_py/test_cold_imports)
    # forbid pulling the asyncio client machinery into a bare app import.
    import redis.asyncio as aioredis
    from redis import backoff as redis_backoff
    from redis import retry as redis_retry

    loop = _running_loop()
    if _client is not None and loop is not None and _client_loop is not loop:
        # New event loop since the client was built (serverless reuse):
        # drop it and rebuild on this loop. aclose() on the old loop's
        # client is unsafe from here, so the old connection is left to
        # the pool's own timeouts / process teardown.
        _client = None
    if _client is None and _init_err is None:
        url = os.getenv("REDIS_URL", "")
        if url == "":
            _init_err = RuntimeError("REDIS_URL is not set")
        else:
            # Mirror the TS server singleton (src/server/redis.ts):
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
        # Unreachable by the decode/guard contract; a real None
        # here is a bug, and python -O must not strip the check.
        raise RuntimeError("_client is None after its error guard")
    return _client


async def dispose() -> None:
    """Close the shared connection if one was opened, then drop the
    cached state so the next client() call re-reads REDIS_URL. The
    lifespan shutdown is the only production caller; a close failure
    is the caller's to absorb (it must not mask the response already
    sent)."""
    global _client, _init_err, _client_loop
    if _client is not None:
        await _client.aclose()
    _client = None
    _init_err = None
    _client_loop = None


def reset_for_test() -> None:
    """Drop the cached client and init state, so the next client() call
    re-reads REDIS_URL. Test-only: production code must never call it —
    the singleton is process-wide. Closing the connection is
    dispose()'s job, not a fire-and-forget coroutine here."""
    global _client, _init_err, _client_loop
    _client = None
    _init_err = None
    _client_loop = None
