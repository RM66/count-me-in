"""Sliding-window rate limiting over Redis, plus client-IP resolution.

The whole sliding-window check is one atomic Lua script: a pipeline
could interleave between concurrent requests — two callers could both
ZADD before either ZCARD runs, letting a burst slip past the limit.

One enforcement path: allow() is the check, the web/deps.py dependency
factories raise RateLimited from it — every route (healthz included)
declares its bucket as a Depends, so there is no second hand-rolled
rate_limited() helper to drift from.
"""

from __future__ import annotations

import os
import random
import time
from dataclasses import dataclass

from starlette.requests import Request

from .. import logx

# KEYS[1] = rate key; ARGV[1] = now (ns), ARGV[2] = window (ns),
# ARGV[3] = limit, ARGV[4] = unique member.
# Returns {allowed (0/1), retry_after_ns}.
SLIDING_WINDOW_LUA = """
local window_start = tonumber(ARGV[1]) - tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '0', window_start)
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[3]) then
	local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
	-- Retry-After: the oldest hit ages out at oldest + window, so the
	-- caller waits oldest + window - now.
	local retry = tonumber(ARGV[2])
	if oldest[2] then
		retry = math.max(0, tonumber(oldest[2]) + tonumber(ARGV[2]) - tonumber(ARGV[1]))
	end
	return {0, retry}
end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
redis.call('PEXPIRE', KEYS[1], math.ceil(tonumber(ARGV[2]) / 1000000))
return {1, 0}
"""


@dataclass(frozen=True)
class RateLimitConfig:
    """At most `limit` requests per `window` seconds per key."""

    limit: int
    window: float  # seconds


async def allow(key: str, cfg: RateLimitConfig) -> tuple[bool, float]:
    """Check the sliding-window limit for key. Returns (allowed,
    retry_after_seconds). On Redis failure it fails open — a limiter
    outage must never block traffic, and without REDIS_URL there is
    nothing to count against. The fail-open choice is recorded in
    ADR-019; the outage itself is logged (rate-limited to once per
    interval) so a silent Redis loss does not go unnoticed."""
    if os.getenv("REDIS_URL", "") == "":
        return True, 0.0
    from .. import redis as redis_mod

    now = time.time_ns()
    member = f"{now}-{random.getrandbits(63)}"
    try:
        r = redis_mod.client()
        # register_script: EVALSHA with automatic NOSCRIPT fallback to
        # EVAL — the Lua body stops traveling on every request.
        # The Script object is local: it is cheap to build and stays
        # correct when tests swap the underlying client.
        script = r.register_script(SLIDING_WINDOW_LUA)
        res = await script(keys=[key], args=[now, int(cfg.window * 1e9), cfg.limit, member])
    except Exception as err:
        logx.warn_every(
            300,
            "rate limiter unavailable — failing open",
            {"scope": "rate-limit", "error": str(err)},
        )
        return True, 0.0
    if not isinstance(res, (list, tuple)) or len(res) < 2:
        return True, 0.0
    if int(res[0]) == 1:
        return True, 0.0
    retry_ns = int(res[1])
    if retry_ns <= 0:
        retry_ns = int(cfg.window * 1e9)
    return False, retry_ns / 1e9


def trust_proxy_headers() -> bool:
    """Forwarded-for headers are honored on Vercel (edge overwrites them)
    or when TRUST_PROXY_HEADERS=1 opts in."""
    if os.getenv("VERCEL") == "1":
        return True
    return os.getenv("TRUST_PROXY_HEADERS") == "1"


def client_ip(request: Request) -> str:
    """The caller's IP. Vercel sets x-vercel-forwarded-for (and
    x-forwarded-for); the first value is the original client, the rest
    are the proxy chain. Falls back to the socket address in dev.

    Trust assumption: on Vercel the edge overwrites these headers, so
    they are trustworthy. Without the opt-in the forwarded headers are
    ignored outside Vercel, so a spoofed X-Forwarded-For cannot rotate
    rate-limit keys."""
    if trust_proxy_headers():
        for header in ("x-vercel-forwarded-for", "x-forwarded-for"):
            fwd = request.headers.get(header, "")
            if fwd:
                return fwd.split(",", 1)[0].strip()
    client = request.scope.get("client")
    if client is not None:
        return client[0]  # type: ignore[no-any-return]
    return ""
