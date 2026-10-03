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
import json
import os
from typing import TYPE_CHECKING

from starlette.requests import Request

if TYPE_CHECKING:
    from starlette.responses import Response as StarletteResponse

from .. import config, logx
from ..errors import walk_exception_chain
from ..jobs.receiver import trace_id_from_headers, verify_qstash_signature
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


def _find_in_chain(err: BaseException, cls: type) -> BaseException | None:
    """Walk the exception chain, not just the outermost type — a wrapped
    error must not slip into a bare 500 (QStash would retry a delivery
    that can never succeed)."""
    for current in walk_exception_chain(err):
        if isinstance(current, cls):
            return current
    return None


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
    if not config.redis_configured():
        return False
    from .. import redis as redis_mod

    try:
        n = await redis_mod.client().exists(key)
    except Exception as err:
        logx.warn_every(
            300,
            "job replay check failed — failing open",
            {"scope": "job-replay", "error": str(err)},
        )
        return False
    return n > 0


async def mark_replayed(key: str) -> None:
    """Record a successful delivery so a replayed signature completes
    without reprocessing. Best-effort: a failure just means the next
    replay reprocesses (still guarded by consumer idempotency)."""
    if not config.redis_configured():
        return
    from .. import redis as redis_mod

    try:
        await redis_mod.client().set(key, "1", ex=REPLAY_TTL_SECONDS)
    except Exception as err:
        logx.warn_every(300, "job replay record failed", {"scope": "job-replay", "error": str(err)})


async def jobs_receiver(request: Request, queue: str) -> StarletteResponse:
    # The next key exists solely for QStash's rotation window and is
    # legitimately empty outside it. The verifier skips an empty key —
    # HMAC with "" is computable by anyone.
    current_signing_key = os.getenv("QSTASH_CURRENT_SIGNING_KEY", "")
    if current_signing_key == "":
        logx.error(RuntimeError("QSTASH_CURRENT_SIGNING_KEY is not set"), {"queue": queue})
        return empty(500).to_starlette()
    next_signing_key = os.getenv("QSTASH_NEXT_SIGNING_KEY", "")

    # The signature covers the exact body bytes — read raw, verify
    # before anything parses it.
    signature = request.headers.get("upstash-signature", "")
    if signature == "":
        return empty(401).to_starlette()
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
        return empty(401).to_starlette()

    # Replay suppression: a captured delivery replayed within the exp
    # window would re-run non-idempotent queues (sweep, demo-refresh).
    # Booking queues also have the consumer idempotency key; this cache
    # is the outer net for all queues. Only successes are recorded, so
    # failed deliveries stay retryable.
    rkey = replay_key(signature)
    if await seen_replay(rkey):
        logx.info("replayed delivery — completing without reprocessing", {"queue": queue})
        return empty(200).to_starlette()

    # An empty body (demo-refresh sends no payload) stays None; a
    # non-empty one must be valid JSON.
    payload: bytes | None = None
    if len(body) > 0:
        try:
            json.loads(body)
        except ValueError:
            return empty(400).to_starlette()
        payload = body

    trace_id = trace_id_from_headers(request.headers)
    try:
        await run_job(queue, payload, trace_id)
    except Exception as err:
        if _find_in_chain(err, UnknownJobQueueError) is not None:
            return empty(404).to_starlette()
        if _find_in_chain(err, InvalidJobPayloadError) is not None:
            return empty(400).to_starlette()
        # Anything else is a handler failure — 500 makes QStash retry.
        fields: dict[str, object] = {"queue": queue}
        if trace_id != "":
            fields["traceId"] = trace_id
        logx.error(err, fields)
        return empty(500).to_starlette()
    await mark_replayed(rkey)
    return empty(200).to_starlette()
