"""Telegram OIDC JWKS fetch + in-process cache (ADR-026).

The validator asks for a key by `kid`; all network lives here so
auth/telegram.py stays a pure pipeline.

Cache: a set is kept for _CACHE_TTL (1h); while cached, refresh,
outage-retry and unknown-kid refetch share one attempt budget —
_last_attempt_at, armed synchronously before the await (atomic under
asyncio; not a Lock — a lazy lock binds to its first loop and breaks
under serverless loop reuse, see web/async_client.py). Concurrent
callers share a single in-flight fetch (_in_flight, also loop-bound);
with an empty cache a failed attempt fast-fails further logins for a
short cooldown instead of paying the fetch timeout per request. A
failed fetch falls back to the stale set when one exists and raises
only with an empty cache (fail-closed). A just-fetched set is never
re-fetched for an unknown kid — a random-kid flood cannot amplify
requests.

Module state is plain data (test_cold_imports.py blocks sockets at
import). The cache is per-instance; a Redis-shared one is future work.
"""

from __future__ import annotations

import asyncio
import json
import time

import jwt

from .. import logx
from ..errors import TelegramValidationFailedError
from ..web.async_client import client

JWKS_URL = "https://oauth.telegram.org/.well-known/jwks.json"
_CACHE_TTL = 3600.0
# Decoded body cap: the live set is ~2 KiB, keys never number in the
# hundreds — 64 KiB is generous headroom against a hostile/compromised
# or just surprising response.
_MAX_BYTES = 64 * 1024
_REFETCH_COOLDOWN = 60.0
# Empty cache only: after a failed attempt, fail closed fast instead of
# paying the fetch timeout per login. The shared in-flight task already
# collapses concurrent attempts; this covers sequential ones.
_FAILED_COOLDOWN = 10.0
_FETCH_TIMEOUT = 5.0

_jwk_set: jwt.PyJWKSet | None = None
_fetched_at = 0.0
# One network attempt per _REFETCH_COOLDOWN while a set is cached. 0.0
# is a safe initial value even on a fresh instance (monotonic counts
# from boot): every read below is gated on a cached set or a fresh
# attempt, and a set can only exist after a real attempt wrote this.
_last_attempt_at = 0.0
# The fetch shared by concurrent callers on one loop. Like the rest of
# the asyncio world it binds to its loop, so a task from a reused
# serverless loop is replaced rather than awaited cross-loop.
_in_flight: asyncio.Task[jwt.PyJWKSet] | None = None


def reset_for_test() -> None:
    """Drop cached state so tests can drive fetch/refetch timing."""
    global _jwk_set, _fetched_at, _last_attempt_at, _in_flight
    _jwk_set = None
    _fetched_at = 0.0
    _last_attempt_at = 0.0
    _in_flight = None


class _JwksError(Exception):
    """Fetch/parse failure carrying the telemetry reason the caller logs —
    never surfaced to the client."""

    def __init__(self, reason: str, detail: str) -> None:
        self.reason = reason
        super().__init__(detail)


async def _fetch_jwks() -> jwt.PyJWKSet:
    """GET and parse the JWKS. Raises _JwksError('jwks_down' |
    'jwks_parse') — never an httpx/jwt exception."""
    try:
        async with client().stream("GET", JWKS_URL, timeout=_FETCH_TIMEOUT) as resp:
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "").lower()
            if "json" not in content_type:
                raise _JwksError("jwks_parse", f"unexpected content-type {content_type!r}")
            # aiter_bytes already decodes gzip — the cap lands on the
            # decoded body.
            chunks: list[bytes] = []
            size = 0
            async for chunk in resp.aiter_bytes():
                size += len(chunk)
                if size > _MAX_BYTES:
                    raise _JwksError("jwks_parse", "jwks body over the 64 KiB cap")
                chunks.append(chunk)
    except _JwksError:
        raise
    except Exception as err:
        raise _JwksError("jwks_down", str(err)) from err

    try:
        return jwt.PyJWKSet.from_dict(json.loads(b"".join(chunks)))
    except Exception as err:
        # PyJWKSetError (no usable key), JSONDecodeError,
        # KeyError/TypeError on a non-object body.
        raise _JwksError("jwks_parse", str(err)) from err


def _key_for(jwks: jwt.PyJWKSet, kid: str) -> jwt.PyJWK | None:
    for key in jwks.keys:
        if key.key_id == kid:
            return key
    return None


async def _fetch_and_cache() -> jwt.PyJWKSet:
    """Fetch inside the shared task so a cancelled caller still leaves
    the cache populated; the failure is logged once here — every waiter
    then decides stale-fallback vs raise on its own."""
    global _jwk_set, _fetched_at
    try:
        jwks = await _fetch_jwks()
    except _JwksError as err:
        logx.error(err, {"scope": "telegram-auth", "reason": err.reason})
        raise
    _jwk_set = jwks
    _fetched_at = time.monotonic()
    return jwks


def _fetch_failed(err: _JwksError) -> jwt.PyJWKSet:
    """Stale-cache fallback, or a fail-closed raise with nothing cached."""
    if _jwk_set is not None:
        logx.warn_every(
            300,
            "telegram jwks refresh failed — using cached set",
            {"scope": "telegram-auth", "reason": err.reason, "error": str(err)},
        )
        return _jwk_set
    raise TelegramValidationFailedError() from None


async def _load() -> jwt.PyJWKSet:
    """Fetch a fresh set, falling back to the stale cache on failure.

    A live attempt on this loop is shared even with a cached set — a
    fresh set beats a stale one on the unknown-kid path. The shared
    attempt budget arms at task creation — an outage costs one timed-out
    fetch per minute, not a stall per login."""
    global _last_attempt_at, _in_flight
    task = _in_flight
    if task is None or task.done() or task.get_loop() is not asyncio.get_running_loop():
        if _jwk_set is not None and time.monotonic() - _last_attempt_at < _REFETCH_COOLDOWN:
            return _jwk_set
        if _jwk_set is None and time.monotonic() - _last_attempt_at < _FAILED_COOLDOWN:
            logx.warn_every(
                300,
                "telegram jwks unavailable — failing closed without a fetch",
                {"scope": "telegram-auth"},
            )
            raise TelegramValidationFailedError()
        _last_attempt_at = time.monotonic()  # before the await — atomic under asyncio
        task = asyncio.get_running_loop().create_task(_fetch_and_cache())
        # Marks the exception retrieved if every waiter detaches first.
        task.add_done_callback(lambda t: t.exception() if not t.cancelled() else None)
        _in_flight = task
    try:
        # shield: one caller's cancellation must not kill a fetch other
        # callers still await (and whose success still fills the cache).
        return await asyncio.shield(task)
    except _JwksError as err:
        return _fetch_failed(err)
    finally:
        if _in_flight is task:
            _in_flight = None


async def get_signing_key(kid: str) -> jwt.PyJWK | None:
    """The key for `kid`, or None when Telegram doesn't publish one.

    Refreshes a stale set; an unknown kid gets one more throttled
    attempt — suppressed outright when the set was just fetched, so a
    cold start costs one request and a random-kid flood cannot amplify.
    Concurrent unknown-kid requests inside the window fail closed (None).

    Raises TelegramValidationFailedError only when no key material at
    all is available (JWKS down/parse with an empty cache)."""
    jwks = _jwk_set
    if jwks is None or time.monotonic() - _fetched_at >= _CACHE_TTL:
        jwks = await _load()
    key = _key_for(jwks, kid)
    if key is not None:
        return key
    return _key_for(await _load(), kid)
