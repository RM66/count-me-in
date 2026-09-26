"""Shared Redis connection. Key names and payload shapes are contracts
(login-link key prefix in contracts/constants_gen), mirroring
@repo/contracts / @repo/redis in the TS monorepo.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import redis.asyncio as aioredis
import threading

_client: aioredis.Redis | None = None
_init_err: Exception | None = None
_lock = threading.Lock()


def client() -> aioredis.Redis:
    """Return the shared connection, opened on first use — a missing
    REDIS_URL surfaces at the call site rather than at import time.

    A failed initialization is cached and re-raised on every call, so a
    bad URL does not leave the client None for the lifetime of the
    instance — every subsequent request gets a clear "REDIS_URL is not
    set" instead of a None-deref 500.
    """
    global _client, _init_err
    # Imported lazily: the cold-start rules (tests_py/test_cold_imports)
    # forbid pulling the asyncio client machinery into a bare app import.
    import redis.asyncio as aioredis
    from redis import backoff as redis_backoff
    from redis import retry as redis_retry

    with _lock:
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
        assert _client is not None
        return _client


def reset_for_test() -> None:
    """Close the shared client (if any) and drop the cached init state, so
    the next client() call re-reads REDIS_URL. Test-only: production code
    must never call it — the singleton is process-wide."""
    global _client, _init_err
    with _lock:
        if _client is not None:
            try:
                # Best-effort close on the cached client; a fresh close
                # needs a loop, so fire-and-forget the coroutine.
                import asyncio

                coro = _client.aclose()
                try:
                    asyncio.get_event_loop().create_task(coro)
                except RuntimeError:
                    coro.close()
            except Exception:
                pass
        _client = None
        _init_err = None
