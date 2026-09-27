"""Shared Redis connection. Key names and payload shapes are contracts
(login-link key prefix in contracts/constants_gen), mirroring
@repo/contracts / @repo/redis in the TS monorepo.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import redis.asyncio as aioredis

_client: aioredis.Redis | None = None
_init_err: Exception | None = None


def client() -> aioredis.Redis:
    """Return the shared connection, opened on first use — a missing
    REDIS_URL surfaces at the call site rather than at import time.

    A failed initialization is cached and re-raised on every call, so a
    bad URL does not leave the client None for the lifetime of the
    instance — every subsequent request gets a clear "REDIS_URL is not
    set" instead of a None-deref 500. No lock: the body has no await, so
    it is atomic with respect to the event loop.
    """
    global _client, _init_err
    # Imported lazily: the cold-start rules (tests_py/test_cold_imports)
    # forbid pulling the asyncio client machinery into a bare app import.
    import redis.asyncio as aioredis
    from redis import backoff as redis_backoff
    from redis import retry as redis_retry

    if _client is None and _init_err is None:
        url = os.getenv("REDIS_URL", "")
        if url == "":
            _init_err = RuntimeError("REDIS_URL is not set")
        else:
            # Mirror @repo/redis: maxRetriesPerRequest 2.
            _client = aioredis.from_url(
                url,
                retry_on_timeout=True,
                retry=redis_retry.Retry(redis_backoff.ExponentialBackoff(), 2),
            )
    if _init_err is not None:
        raise _init_err
    if _client is None:
        # Unreachable by the decode/guard contract; a real None
        # here is a bug, and python -O must not strip the check.
        raise RuntimeError("_client is None after its error guard")
    return _client


def reset_for_test() -> None:
    """Drop the cached client and init state, so the next client() call
    re-reads REDIS_URL. Test-only: production code must never call it —
    the singleton is process-wide. Closing the connection is the
    lifespan's job, not a fire-and-forget coroutine here."""
    global _client, _init_err
    _client = None
    _init_err = None
