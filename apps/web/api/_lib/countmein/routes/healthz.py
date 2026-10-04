"""/api/healthz — the liveness probe with dependency checks (PG and
Redis). QStash is deliberately not probed: an outbound call per probe
would burn the request budget; publish failures surface through the
outbox backlog metrics instead.

The handler carries its own recovery: the lazy singletons raise on a
missing connection env, and the probe is where that misconfiguration
must surface as a 503 JSON body naming the broken dependency — not a
connection reset with a stack in the log. Rate-limited declaratively
like every other route (a Depends bucket), so the handler stays
recovery-only. The probe is unauthenticated and burns a connection
from the small serverless pool; the limiter fails open, so monitoring
survives a Redis outage.
"""

from __future__ import annotations

import os
import traceback

from fastapi import Depends, FastAPI
from starlette.responses import Response

from .. import config, logx
from ..web.deps import ip_rate_limit
from ..web.json_enc import dumps_compact

_MAX_STACK = 8 << 10

# Health probes are module-level so tests can pin the recovery path
# without initializing the pools — the engine factory caches a missing
# POSTGRES_URL failure for the process lifetime, and a test triggering
# it would poison every later test.


async def _probe_postgres() -> None:
    from ..db.client import ping

    await ping()


async def _probe_redis() -> None:
    from .. import redis as redis_mod

    await redis_mod.client().ping()


def _missing_healthz_env() -> list[str]:
    """Name the connection variables that are absent or blank. The
    recovery cannot know which probe failed (both raise inside lazy
    singletons), so the list reports env presence — a fact — instead of
    guessing."""
    return [name for name in ("POSTGRES_URL", "REDIS_URL") if os.getenv(name, "").strip() == ""]


def _panicking_env() -> str | None:
    """The variable whose absence is the probe's panic path. Only
    Postgres fails on a missing env (the lazy engine raises); Redis
    unconfigured is the deliberate `skipped` state, not an outage."""
    if os.getenv("POSTGRES_URL", "").strip() == "":
        return "POSTGRES_URL"
    return None


def _encoder_body(checks: dict[str, str]) -> bytes:
    """The probe body is compact JSON with sorted map keys and a
    trailing newline — the exact bytes the parity goldens pin."""
    return (dumps_compact(checks) + "\n").encode("utf-8")


def _panic_response(error: str) -> Response:
    """The 503 body for a probe that could not run at all — both
    dependencies reported failed plus the missing-env fact list."""
    return Response(
        content=_encoder_body(
            {
                "postgres": "fail",
                "redis": "fail",
                "error": f"dependency probe panicked: {error}",
                "missingEnv": _missing_healthz_env(),  # type: ignore[dict-item]
            }
        ),
        status_code=503,
        headers={"Content-Type": "application/json"},
    )


async def handle_healthz() -> Response:
    try:
        # A missing POSTGRES_URL is the probe's panic path: the answer
        # is the full-failure body naming the variables, not a
        # single-dependency "fail" the per-probe except would swallow it
        # into. Redis unconfigured is the deliberate `skipped` state.
        panicking = _panicking_env()
        if panicking is not None:
            # healthz is excluded from the access log — without this
            # line a misconfigured deploy leaves no trace.
            logx.error(
                RuntimeError(f"healthz panic: {panicking} is not set"),
                {"scope": "healthz"},
            )
            return _panic_response(f"{panicking} is not set")

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
        return _panic_response(str(rec))


def register_healthz(app: FastAPI) -> None:
    # 30/min per IP via the same dependency every other route uses
    # (web/deps.py) — not a bespoke limiter inside the handler.
    app.add_api_route(
        "/api/healthz",
        handle_healthz,
        methods=["GET"],
        include_in_schema=False,
        dependencies=[Depends(ip_rate_limit("rl:healthz:", 30, 60.0))],
    )
