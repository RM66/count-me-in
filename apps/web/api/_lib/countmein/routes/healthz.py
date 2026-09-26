"""/api/healthz — the liveness probe with dependency checks (PG and
Redis). QStash is deliberately not probed: an outbound call per probe
would burn the request budget; publish failures surface through the
outbox backlog metrics instead.

The handler carries its own recovery: the lazy singletons raise on a
missing connection env, and the probe is exactly the place where that
misconfiguration must surface as a 503 with a JSON body naming the
broken dependency — not as a connection reset with a runtime stack in
the log. It is also rate-limited: the probe is unauthenticated and
each call burns a connection from the small serverless pool; the
limiter fails open, so monitoring survives a Redis outage.
"""

from __future__ import annotations

import os
import traceback
from typing import TYPE_CHECKING

from fastapi import FastAPI
from starlette.requests import Request

if TYPE_CHECKING:
    pass
from starlette.responses import Response

from .. import config, logx
from ..httpx_.gojson import dumps_go
from ..httpx_.ratelimit import RateLimitConfig, client_ip, rate_limited

_MAX_STACK = 8 << 10

# Health probes are module-level so tests can pin the recovery path
# without initializing the process-wide pools (the engine factory
# raises on a missing POSTGRES_URL and caches that failure for the
# process lifetime — a test triggering it would poison every later
# test in this module).


async def _probe_postgres() -> None:
    from ..db.client import ping

    await ping()


async def _probe_redis() -> None:
    from .. import redis as redis_mod

    await redis_mod.client().ping()


def _missing_healthz_env() -> list[str]:
    """Name the connection variables that are absent or blank. The
    recovery below cannot know which probe failed (both raise from
    inside the lazy singletons), so the list reports env presence — a
    fact — instead of guessing which dependency failed."""
    return [name for name in ("POSTGRES_URL", "REDIS_URL") if os.getenv(name, "").strip() == ""]


def _encoder_body(checks: dict[str, str]) -> bytes:
    """Go writes the probe with json.NewEncoder(w).Encode — compact JSON
    with sorted map keys and a trailing newline (Encoder, not Marshal).
    The parity goldens pin the exact bytes."""
    return (dumps_go(checks) + "\n").encode("utf-8")


async def handle_healthz(request: Request) -> Response:
    try:
        limited = await rate_limited(
            request, "rl:healthz:" + client_ip(request), RateLimitConfig(limit=30, window=60.0)
        )
        if limited is not None:
            return limited.to_starlette()

        checks: dict[str, str] = {"postgres": "ok", "redis": "ok"}
        status = 200
        try:
            await _probe_postgres()
        except Exception:
            checks["postgres"] = "fail"
            status = 503
        if config.redis_configured():
            try:
                await _probe_redis()
            except Exception:
                checks["redis"] = "fail"
                status = 503
        else:
            checks["redis"] = "skipped"
        return Response(
            content=_encoder_body(checks),
            status_code=status,
            headers={"Content-Type": "application/json"},
        )
    except Exception as rec:
        stack = "".join(traceback.format_exc())[-_MAX_STACK:]
        logx.error(RuntimeError(f"healthz panic: {rec}"), {"scope": "healthz", "stack": stack})
        return Response(
            content=_encoder_body(
                {
                    "postgres": "fail",
                    "redis": "fail",
                    "error": f"dependency probe panicked: {rec}",
                    "missingEnv": _missing_healthz_env(),  # type: ignore[dict-item]
                }
            ),
            status_code=503,
            headers={"Content-Type": "application/json"},
        )


def register_healthz(app: FastAPI) -> None:
    app.add_api_route("/api/healthz", handle_healthz, methods=["GET"], include_in_schema=False)
