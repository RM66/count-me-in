"""POST /api/jobs/{queue} — the QStash receiver (ADR-012).

Everything QStash delivers lands here: booking.created/cancelled
published after the booking commit, and the demo.refresh schedule. The
only caller is QStash itself, so authorization is its per-request
signature (upstash-signature) rather than a session or ticket — and
every response body is empty, because the consumer reads status codes.

Status semantics are the queue's retry budget:
  - 200 — delivered, or deliberately completed (recipient unreachable)
  - 400 — malformed payload; retrying resends the same bad bytes
  - 401 — missing/invalid signature
  - 404 — unknown queue name (e.g. a destination for another app)
  - 500 — handler failure; this is what makes QStash retry
"""

from __future__ import annotations

import hashlib
import os

from starlette.requests import Request
from starlette.responses import Response as StarletteResponse

from .. import logx
from .. import redis as redis_mod
from ..jobs.receiver import verify_qstash_signature
from ..jobs.run import (
    InvalidJobPayloadError,
    UnknownJobQueueError,
    run_job,
)
from ..web import empty
from ..web.guards import read_body_or_413

# How long a succeeded delivery's signature is remembered. Short-lived
# vs the consumer idempotency window (24h): it only needs to cover the
# signature's exp horizon, after which the verifier rejects replays
# anyway. Only successes are recorded — a failed delivery (500) must
# stay retryable for QStash's at-least-once redelivery.
REPLAY_TTL_SECONDS = 3600


def replay_key(signature: str) -> str:
    """Identify a delivery by the hash of its signature — the signature
    covers the exact body bytes, so equal signatures mean equal
    deliveries. Hashed, not raw: a bearer credential must not land
    verbatim in Redis keys/logs."""
    return "job:replay:" + hashlib.sha256(signature.encode()).hexdigest()


async def seen_replay(key: str) -> bool:
    """Whether this exact delivery already succeeded. Fail-open
    (ADR-019): without Redis or on a Redis error the delivery proceeds —
    consumer idempotency is the second net."""
    n = await redis_mod.fail_open(
        lambda r: r.exists(key),
        0,
        warn_msg="job replay check failed — failing open",
        fields={"scope": "job-replay"},
    )
    return n > 0


async def mark_replayed(key: str) -> None:
    """Record a successful delivery so a replayed signature completes
    without reprocessing. Best-effort: a failure just means the next
    replay reprocesses (still guarded by consumer idempotency)."""
    await redis_mod.fail_open(
        lambda r: r.set(key, "1", ex=REPLAY_TTL_SECONDS),
        None,
        warn_msg="job replay record failed",
        fields={"scope": "job-replay"},
    )


async def jobs_receiver(request: Request, queue: str) -> StarletteResponse:
    # The next key exists solely for QStash's rotation window and is
    # legitimately empty outside it. The verifier skips an empty key —
    # HMAC with "" is computable by anyone.
    current_signing_key = os.getenv("QSTASH_CURRENT_SIGNING_KEY", "")
    if current_signing_key == "":
        logx.error(RuntimeError("QSTASH_CURRENT_SIGNING_KEY is not set"), {"queue": queue})
        return empty(500)
    next_signing_key = os.getenv("QSTASH_NEXT_SIGNING_KEY", "")

    # The signature covers the exact body bytes — read raw, verify
    # before anything parses it.
    signature = request.headers.get("upstash-signature", "")
    if signature == "":
        return empty(401)
    body = await read_body_or_413(request)
    # Destination binding: the sub claim must name this deployment's
    # receiver URL — signing keys are account-scoped, so a delivery for
    # another destination in the same account must not verify here.
    expected_sub = os.getenv("APP_URL", "").rstrip("/") + "/api/jobs/" + queue
    if not verify_qstash_signature(
        body,
        signature,
        current_signing_key,
        next_signing_key,
        expected_sub,
    ):
        return empty(401)

    # Replay suppression: a captured delivery replayed within the exp
    # window would re-run non-idempotent queues (sweep, demo-refresh).
    # Booking queues also have the consumer idempotency key; this cache
    # is the outer net for all queues. Only successes are recorded, so
    # failed deliveries stay retryable.
    rkey = replay_key(signature)
    if await seen_replay(rkey):
        logx.info("replayed delivery — completing without reprocessing", {"queue": queue})
        return empty(200)

    # An empty body (demo-refresh sends no payload) stays None; payload
    # parsing and the 400 boundary live in run_job — once.
    payload: bytes | None = body if len(body) > 0 else None

    # Starlette headers compare case-insensitively; "" when the header
    # is absent (sweeper re-publish, legacy deliveries).
    trace_id = request.headers.get("upstash-trace-id", "")
    try:
        await run_job(queue, payload, trace_id)
    except UnknownJobQueueError:
        return empty(404)
    except InvalidJobPayloadError:
        return empty(400)
    except Exception as err:
        # Anything else is a handler failure — 500 makes QStash retry.
        fields: dict[str, object] = {"queue": queue}
        if trace_id != "":
            fields["traceId"] = trace_id
        logx.error(err, fields)
        return empty(500)
    await mark_replayed(rkey)
    return empty(200)
