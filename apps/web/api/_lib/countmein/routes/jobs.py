"""POST /api/jobs/{queue} — the QStash receiver (ADR-012).

Everything QStash delivers lands here: booking.created and
booking.cancelled published after the booking transaction commits, and
the demo.refresh schedule. The only caller is QStash itself, so
authorization is its per-request signature (upstash-signature, verified
with the signing keys) rather than a session or ticket — and every
response body is empty, because the consumer is a queue that reads
status codes, not copy.

Status semantics are the queue's retry budget:
  - 200 — delivered, or deliberately completed (recipient unreachable)
  - 400 — malformed payload; retrying would resend the same bad bytes
  - 401 — missing/invalid signature
  - 404 — unknown queue name (e.g. a destination configured for
    another app)
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

# replayTTL — how long a successfully processed delivery's signature is
# remembered. Short-lived relative to the consumer idempotency window
# (24h): it only needs to cover the signature's exp horizon, after
# which the verifier rejects the replay anyway. Only successes are
# recorded — a failed delivery (500) must stay retryable, so QStash's
# at-least-once redelivery still reprocesses it.
REPLAY_TTL_SECONDS = 3600


def _find_in_chain(err: BaseException, cls: type) -> BaseException | None:
    """Walk the exception chain (cause/context), not just the outermost
    type — a wrapped error must not slip past the mapping into a bare
    500 (which would make QStash retry a delivery that can never
    succeed)."""
    for current in walk_exception_chain(err):
        if isinstance(current, cls):
            return current
    return None


def replay_key(signature: str) -> str:
    """Identify a delivery by the hash of its signature (the signature
    covers the exact body bytes, so equal signatures mean equal
    deliveries). Hashed, not raw: the signature is a bearer credential
    for the exp window and must not land verbatim in Redis keys/logs."""
    return "job:replay:" + hashlib.sha256(signature.encode()).hexdigest()


async def seen_replay(key: str) -> bool:
    """Whether this exact delivery already succeeded. Fail-open
    (ADR-019): without Redis, or on a Redis error, the delivery proceeds
    normally — the consumer idempotency guard is the second net."""
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
    without reprocessing. Best-effort: a failure only means the next
    replay reprocesses (still guarded by consumer idempotency)."""
    if not config.redis_configured():
        return
    from .. import redis as redis_mod

    try:
        await redis_mod.client().set(key, "1", ex=REPLAY_TTL_SECONDS)
    except Exception as err:
        logx.warn_every(300, "job replay record failed", {"scope": "job-replay", "error": str(err)})


async def jobs_receiver(request: Request, queue: str) -> StarletteResponse:
    # Only the current signing key is required. The next key exists
    # solely for QStash's key-rotation window and is legitimately empty
    # outside it — requiring it non-empty would 500 every delivery (and
    # burn QStash's retry budget) for no reason. The verifier skips an
    # empty key entirely: HMAC with "" is computable by anyone, so a
    # token forged with the empty key must not verify.
    current_signing_key = os.getenv("QSTASH_CURRENT_SIGNING_KEY", "")
    if current_signing_key == "":
        logx.error(RuntimeError("QSTASH_CURRENT_SIGNING_KEY is not set"), {"queue": queue})
        return empty(500).to_starlette()
    next_signing_key = os.getenv("QSTASH_NEXT_SIGNING_KEY", "")

    # The signature covers the exact bytes of the body, so it must be
    # read raw and verified before anything parses it.
    signature = request.headers.get("upstash-signature", "")
    if signature == "":
        return empty(401).to_starlette()
    body = await read_body_or_413(request)
    # Destination binding: the sub claim must name this deployment's
    # receiver URL — the signing keys are account-scoped, so a delivery
    # signed for another destination in the same account must not
    # verify here.
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
    # window would otherwise re-run non-idempotent queues (sweep,
    # demo-refresh). Booking queues are additionally guarded by the
    # consumer idempotency key; this cache is the outer net for all
    # queues. Only past successes are recorded, so failed deliveries
    # stay retryable.
    rkey = replay_key(signature)
    if await seen_replay(rkey):
        logx.info("replayed delivery — completing without reprocessing", {"queue": queue})
        return empty(200).to_starlette()

    # An empty body (the demo-refresh schedule sends no payload) stays
    # None; a non-empty one must be valid JSON.
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
        # The chain is walked, not a type switch: a wrapped error must
        # not slip past the mapping into a bare 500 (which would make
        # QStash retry a delivery that can never succeed).
        if _find_in_chain(err, UnknownJobQueueError) is not None:
            return empty(404).to_starlette()
        if _find_in_chain(err, InvalidJobPayloadError) is not None:
            return empty(400).to_starlette()
        # Anything else is a handler failure — a 500 so QStash retries
        # the delivery.
        fields: dict[str, object] = {"queue": queue}
        if trace_id != "":
            fields["traceId"] = trace_id
        logx.error(err, fields)
        return empty(500).to_starlette()
    await mark_replayed(rkey)
    return empty(200).to_starlette()
