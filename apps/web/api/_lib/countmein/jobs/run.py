"""Job dispatch — the one place a QStash delivery becomes a handler
call. Owns the policies every job shares:

- Payload validation: a malformed body is a 400-class outcome
  (non-retryable — resending the same bad bytes burns the budget), so
  parsing happens here, before any handler runs.
- Consumer idempotency: the payload's outboxId is SET-NX'd in Redis
  before dispatch, so a duplicate delivery (sweeper re-publish outside
  the dedup window, redelivery after a lost response) cannot
  double-notify. A *failed* dispatch releases the claim (run_claimed),
  so QStash's retry is processed instead of answered as a duplicate:
  at-least-once with duplicate suppression on success, never a silent
  loss. Fails open on a Redis outage, same stance as the rate limiter.
- Retry classification: a handler error is returned for the route to
  answer 500 — what makes QStash retry — except
  TelegramUnreachableError, absorbed with a log: a recipient who never
  pressed Start cannot be messaged now or in five minutes, so the
  delivery completes rather than retries."""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from .. import config, logx, redis
from ..contracts import models_gen as gen
from ..contracts.constants_gen import (
    QUEUE_BOOKING_CANCELLED,
    QUEUE_BOOKING_CREATED,
    QUEUE_DEMO_REFRESH,
    QUEUE_NOTIFICATION_OUTBOX_SWEEP,
)
from .booking_cancelled import handle_booking_cancelled
from .booking_created import handle_booking_created
from .demo_refresh import handle_demo_refresh
from .env import read_env
from .outbox_sweep import handle_outbox_sweep
from .telegram import TelegramTerminalError, TelegramUnreachableError


class UnknownJobQueueError(Exception):
    """The {queue} path segment names no known queue."""

    def __init__(self, queue: str):
        super().__init__(f"unknown job queue {queue!r}")
        self.queue = queue


class InvalidJobPayloadError(Exception):
    """The delivery body does not parse / does not match the queue's
    schema."""

    def __init__(self, queue: str):
        super().__init__(f"invalid payload for job queue {queue!r}")
        self.queue = queue


@dataclass(frozen=True)
class _PayloadQueue:
    """A queue carrying a typed payload: spec schema name (the
    validation authority), generated DTO class, and handler — called as
    ``handle(env, payload, trace_id)`` inside the idempotency claim.
    Adding a payload queue is one row here; parse_job and run_job read
    this table instead of switching on the queue name."""

    schema: str
    model: type[gen.BookingCreatedJob | gen.BookingCancelledJob]
    handle: Callable[..., Awaitable[None]]


# The dispatch table — one source for "which queues exist, their
# payload shape, their handler". Schedule queues take any body,
# including an empty one.
_PAYLOAD_QUEUES: dict[str, _PayloadQueue] = {
    QUEUE_BOOKING_CREATED: _PayloadQueue(
        "BookingCreatedJob", gen.BookingCreatedJob, handle_booking_created
    ),
    QUEUE_BOOKING_CANCELLED: _PayloadQueue(
        "BookingCancelledJob", gen.BookingCancelledJob, handle_booking_cancelled
    ),
}
_SCHEDULE_QUEUES: dict[str, Callable[[], Awaitable[None]]] = {
    QUEUE_DEMO_REFRESH: handle_demo_refresh,
    QUEUE_NOTIFICATION_OUTBOX_SWEEP: handle_outbox_sweep,
}


def _parse_payload(queue: str, body: bytes | None) -> dict:  # type: ignore[type-arg]
    """Absent body fails the object schemas (both booking queues require
    fields); a present body must be a JSON object — the spec validator
    does the rest. The queue name rides along so the error names what
    failed."""
    if not body:
        raise InvalidJobPayloadError(queue)
    try:
        parsed = json.loads(body)
    except ValueError:
        raise InvalidJobPayloadError(queue) from None
    if not isinstance(parsed, dict):
        raise InvalidJobPayloadError(queue)
    return parsed


def _spec_check(schema_name: str, queue: str, m: dict) -> None:  # type: ignore[type-arg]
    """Validate the payload against the bundled spec — the same
    authority the request decoders use (ADR-024 C1), so shapes and enum
    vocabularies cannot drift from wire.ts. Any violation is a terminal
    400: QStash must not retry bytes that can never dispatch. The route
    answers with empty bodies, so a bare any-errors check suffices — no
    message translation."""
    from ..validation import spec

    if any(spec.validator(schema_name).iter_errors(m)):
        raise InvalidJobPayloadError(queue)


def _construct(
    model_cls: type[gen.BookingCreatedJob | gen.BookingCancelledJob],
    m: dict,  # type: ignore[type-arg]
) -> gen.BookingCreatedJob | gen.BookingCancelledJob:
    """model_construct over the schema-valid dict, unknown keys stripped
    like Zod (the spec carries no additionalProperties)."""
    return model_cls.model_construct(**{k: v for k, v in m.items() if k in model_cls.model_fields})


def parse_job(
    queue: str, body: bytes | None
) -> gen.BookingCreatedJob | gen.BookingCancelledJob | None:
    """Validate one QStash delivery body without touching the network or
    DB: UnknownJobQueueError for a foreign queue, InvalidJobPayloadError
    for a malformed payload, the DTO when the delivery may proceed, None
    for schedule queues (any body is valid for them). Extracted so tests
    pin the 400/404 boundary without invoking handlers (which would
    reseed the demo DB or sweep the outbox)."""
    if queue in _SCHEDULE_QUEUES:
        return None
    q = _PAYLOAD_QUEUES.get(queue)
    if q is None:
        raise UnknownJobQueueError(queue)
    m = _parse_payload(queue, body)
    _spec_check(q.schema, queue, m)
    return _construct(q.model, m)


# Longer than QStash's retry horizon (5 retries with backoff top out
# well under a day), so a redelivery inside the window is recognized.
_IDEMPOTENCY_TTL = timedelta(hours=24)
# The claim is a lease, not a permanent marker — it covers the send
# window (maxDuration 10s) plus margin. An instance killed mid-send lets
# the lease expire, so the retry/re-publish is processed instead of
# suppressed — the crash window cannot break at-least-once.
_CLAIM_LEASE = timedelta(seconds=60)


def _processed_key(outbox_id: str) -> str:
    """The consumer idempotency key for one outbox row."""
    return "job:processed:" + outbox_id


async def claim_delivery(outbox_id: str) -> bool:
    """SET-NX the outbox id with the short claim lease: True means this
    is the row's first delivery and the handler may send. A lost race or
    Redis error fails open — the delivery proceeds (ADR-019): an outage
    must not block notifications; the worst case is a rare duplicate,
    never a lost one. The lease is the claim window: an instance killed
    mid-send leaves it to expire, so the retry is processed."""
    if not config.redis_configured():
        return True
    try:
        ok = await redis.client().set(
            _processed_key(outbox_id), "1", nx=True, ex=int(_CLAIM_LEASE.total_seconds())
        )
    except Exception as err:
        logx.warn_every(
            5 * 60,
            "job idempotency check failed — failing open",
            {"scope": "job-idempotency", "error": str(err)},
        )
        return True
    return bool(ok)


async def finalize_delivery(outbox_id: str) -> None:
    """Extend a successful delivery's claim to the full idempotency TTL.
    Best-effort: a failure only risks a rare duplicate on a replay."""
    if not config.redis_configured():
        return
    try:
        await redis.client().expire(
            _processed_key(outbox_id), int(_IDEMPOTENCY_TTL.total_seconds())
        )
    except Exception as err:
        logx.warn_every(
            5 * 60,
            "job idempotency finalize failed — replays may duplicate",
            {"scope": "job-idempotency", "outboxId": outbox_id, "error": str(err)},
        )


async def release_delivery(outbox_id: str) -> None:
    """Drop the claim of a delivery whose send failed retryably, so
    QStash's retry (or the sweeper's re-publish) reaches the handler
    instead of being suppressed. The outbox row is already `sent`, so
    this Redis key is the only place the retry is tracked.

    Deliberate trade-off: a transport failure is ambiguous (Telegram may
    have processed the request before the response was lost), so a
    released retry can duplicate a message — at-least-once is the rule.

    Best-effort: if the DEL fails the retry is skipped as a duplicate
    (at-most-once) rather than risking a double send."""
    if not config.redis_configured():
        return
    try:
        await redis.client().delete(_processed_key(outbox_id))
    except Exception as err:
        logx.warn_every(
            5 * 60,
            "job idempotency release failed — the retry will be suppressed",
            {"scope": "job-idempotency", "outboxId": outbox_id, "error": str(err)},
        )


async def run_claimed(
    queue: str, trace_id: str, outbox_id: str, run: Callable[[], Awaitable[None]]
) -> None:
    """Wrap one booking-queue dispatch in the idempotency guard: claim
    (short lease) → send → release on a retryable failure → finalize
    (full TTL) on success. Terminal outcomes _with_retry_policy absorbs
    (unreachable chat, rejected content) keep the claim — complete,
    never re-sent. An instance killed mid-send lets the lease expire, so
    the retry is processed — the crash window cannot lose the
    notification."""
    if not await claim_delivery(outbox_id):
        logx.info(
            "duplicate delivery — completing without sending",
            {"queue": queue, "outboxId": outbox_id, "traceId": trace_id},
        )
        return
    try:
        await _with_retry_policy(queue, trace_id, run)
    except Exception:
        await release_delivery(outbox_id)
        raise
    await finalize_delivery(outbox_id)


async def _with_retry_policy(queue: str, trace_id: str, run: Callable[[], Awaitable[None]]) -> None:
    """Absorb the failures that must never be retried — reaching QStash
    they would spend the retry budget and end in a dropped message that
    reads like an outage. The guest's success page already carries the
    management link — the designed fallback."""
    try:
        await run()
    except TelegramUnreachableError as err:
        fields: dict[str, Any] = {"queue": queue, "error": str(err)}
        if trace_id != "":
            fields["traceId"] = trace_id
        logx.info("recipient unreachable — completing without retry", fields)
    except TelegramTerminalError as err:
        fields = {"queue": queue, "error": str(err)}
        if trace_id != "":
            fields["traceId"] = trace_id
        logx.info("message content rejected — completing without retry", fields)


async def run_job(queue: str, body: bytes | None, trace_id: str) -> None:
    """Validate and run one QStash delivery. body is the raw request
    bytes, or None for an empty body (demo-refresh sends none). Raises
    UnknownJobQueueError for a foreign queue, InvalidJobPayloadError for
    a malformed payload; any other error is a handler failure the route
    answers 500 — what makes QStash retry."""
    q = _PAYLOAD_QUEUES.get(queue)
    if q is not None:
        payload = parse_job(queue, body)
        if payload is None:
            # Unreachable: parse_job returns the DTO for every payload
            # queue; a raise so python -O cannot strip the check.
            raise RuntimeError("payload is None for a payload queue")
        env = read_env()
        outbox_id = str(payload.outboxId)

        async def _run() -> None:
            await q.handle(env, payload, trace_id)

        await run_claimed(queue, trace_id, outbox_id, _run)
        return
    handle = _SCHEDULE_QUEUES.get(queue)
    if handle is None:
        raise UnknownJobQueueError(queue)
    parse_job(queue, body)  # pins the schedule-queue boundary (accepts anything)
    # Schedule handlers: a failure escapes as 500 so QStash retries
    # (demo seed refresh; sweeper re-publishing rows inline missed).
    try:
        await handle()
    except Exception as err:
        logx.error(err, {"queue": queue})
        raise
