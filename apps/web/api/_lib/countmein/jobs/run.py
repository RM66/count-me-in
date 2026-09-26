"""Job dispatch — the one place a QStash delivery becomes a handler
call. Owns the policies every job shares:

- Payload validation: a malformed body gets a 400-class outcome
  (non-retryable — QStash would burn its budget re-sending the same bad
  bytes), so parsing happens here, before any handler runs.
- Consumer idempotency: the payload's outboxId is SET-NX'd in Redis
  before dispatch, so a duplicate delivery — a sweeper re-publish
  outside QStash's dedup window, a redelivery after a lost response —
  cannot double-notify the same recipient. A *failed* dispatch
  releases the claim (run_claimed), so QStash's retry after a Telegram
  timeout is processed again instead of being answered as a duplicate:
  the guarantee is at-least-once with duplicate suppression on success,
  never a silent loss. Fails open on a Redis outage (the delivery
  proceeds), same stance as the rate limiter.
- Retry classification: a handler error is returned for the route to
  answer 500 with, which is what makes QStash retry — except
  TelegramUnreachableError, which is absorbed with a log: a recipient
  who never pressed Start on the bot cannot be messaged now or in five
  minutes, so the delivery is completed rather than retried."""

from __future__ import annotations

import json
import uuid
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
    QUEUE_OUTBOX_SWEEP,
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


@dataclass
class ParsedJob:
    """The outcome of validating one delivery: the typed payload for the
    booking queues, None for the schedule-driven queues (demo.refresh,
    outbox.sweep send no payload). Parsing happens exactly once — the
    dispatch switch consumes this value directly."""

    booking_created: Any = None
    booking_cancelled: Any = None


def _root(value: Any) -> Any:
    while hasattr(value, "root"):
        value = value.root
    return value


def _valid_recipient(v: str) -> bool:
    return v in ("organizer", "guest")


def _valid_booking_id(v: str) -> bool:
    try:
        uuid.UUID(v)
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def _parse_payload(queue: str, body: bytes | None) -> dict:  # type: ignore[type-arg]
    """Mirror the Zod safeParse: absent body fails the object schemas
    (both booking queues require their fields), and a present body must
    be a JSON object of the right shape. The queue name rides along so
    the error names what failed."""
    if not body:
        raise InvalidJobPayloadError(queue)
    try:
        parsed = json.loads(body)
    except ValueError:
        raise InvalidJobPayloadError(queue) from None
    if not isinstance(parsed, dict):
        raise InvalidJobPayloadError(queue)
    return parsed


def parse_job(queue: str, body: bytes | None) -> ParsedJob:
    """Validate one QStash delivery body without touching the network
    or the database: UnknownJobQueueError for a foreign queue name,
    InvalidJobPayloadError for a malformed payload, no error when the
    delivery may proceed. The schedule-driven queues (demo.refresh,
    outbox.sweep) send no payload, so any body — including an empty one
    — is valid for them. Extracted so tests pin the 400/404 boundary
    without invoking handlers (which would reseed the demo DB or sweep
    the outbox as a side effect)."""
    if queue == QUEUE_BOOKING_CREATED:
        m = _parse_payload(queue, body)
        # bookingId/outboxId are uuids on the wire (bookingCreatedJob
        # schema); a malformed id must be a 400, not a 500 — otherwise
        # QStash burns all retries on bytes that can never succeed.
        # model_construct (not model_validate): the generated UUIDModel
        # carries a pattern constraint pydantic cannot apply to the
        # coerced UUID — the same quirk decode.py works around.
        if (
            not _valid_booking_id(m.get("bookingId", ""))
            # A missing outboxId marshals as the zero uuid in Go and
            # parses fine — parity means the same acceptance here.
            or not _valid_booking_id(m.get("outboxId", "00000000-0000-0000-0000-000000000000"))
            or not _valid_recipient(str(m.get("recipient", "")))
        ):
            raise InvalidJobPayloadError(queue)
        job = gen.BookingCreatedJob.model_construct(**m)
        return ParsedJob(booking_created=job)
    if queue == QUEUE_BOOKING_CANCELLED:
        m = _parse_payload(queue, body)
        if (
            not _valid_booking_id(m.get("bookingId", ""))
            or not _valid_booking_id(m.get("outboxId", "00000000-0000-0000-0000-000000000000"))
            or str(m.get("cancelledBy", "")) not in ("guest", "organizer")
        ):
            raise InvalidJobPayloadError(queue)
        job = gen.BookingCancelledJob.model_construct(**m)  # type: ignore[assignment]
        return ParsedJob(booking_cancelled=job)
    if queue in (QUEUE_DEMO_REFRESH, QUEUE_OUTBOX_SWEEP):
        return ParsedJob()
    raise UnknownJobQueueError(queue)


# Longer than QStash's retry horizon (5 retries with exponential
# backoff tops out well under a day), so a redelivery of the same
# outbox row inside the window is always recognized.
_IDEMPOTENCY_TTL = timedelta(hours=24)


def _processed_key(outbox_id: str) -> str:
    """The consumer idempotency key for one outbox row."""
    return "job:processed:" + outbox_id


async def claim_delivery(outbox_id: str) -> bool:
    """SET-NX the outbox id: True means this delivery is the first for
    that row and the handler may send. A lost race (or a Redis error)
    fails open — the delivery proceeds — matching the ADR-019 stance: an
    idempotency outage must not block notifications, and the worst case
    is a rare duplicate message, never a lost one."""
    if not config.redis_configured():
        return True
    try:
        ok = await redis.client().set(
            _processed_key(outbox_id), "1", nx=True, ex=int(_IDEMPOTENCY_TTL.total_seconds())
        )
    except Exception as err:
        logx.warn_every(
            5 * 60,
            "job idempotency check failed — failing open",
            {"scope": "job-idempotency", "error": str(err)},
        )
        return True
    return bool(ok)


async def release_delivery(outbox_id: str) -> None:
    """Drop the claim of a delivery whose send failed retryably, so
    QStash's retry (or the sweeper's re-publish) reaches the handler
    again instead of being suppressed as a duplicate. The outbox row was
    already marked `sent` by its publisher, so this Redis key is the
    only place the retry is tracked.

    The trade-off is deliberate: a transport failure is ambiguous
    (Telegram might have processed the request before the response was
    lost), so a released retry can duplicate a message. At-least-once is
    the product rule — a rare duplicate beats a silently lost
    notification, which is what claiming without releasing produces.

    Best-effort: if the DEL fails the retry is skipped as a duplicate
    (at-most-once for that row) rather than risking a double send, and
    the logged failure is the incident signal."""
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
    """Wrap one booking-queue dispatch in the consumer idempotency
    guard: claim → send → release on a retryable failure. Terminal
    outcomes that _with_retry_policy absorbs (unreachable chat, rejected
    content) keep the claim — those deliveries are complete and must
    never be re-sent."""
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


async def _with_retry_policy(queue: str, trace_id: str, run: Callable[[], Awaitable[None]]) -> None:
    """Absorb the failures that must never be retried: letting them
    reach QStash would spend the retry budget and end in a dropped
    message that reads like an outage. The guest's on-screen success
    page, which already carries the management link, is the designed
    fallback."""
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
    """Validate and run one QStash delivery. body is the raw bytes of
    the request, or None for an empty body (the demo-refresh schedule
    sends no payload). Raises UnknownJobQueueError for a foreign queue
    name and InvalidJobPayloadError for a malformed payload; any other
    error is a handler failure the route answers 500 with, which is
    what makes QStash retry."""
    job = parse_job(queue, body)
    if queue == QUEUE_BOOKING_CREATED:
        env = read_env()
        outbox_id = str(_root(job.booking_created.outboxId))

        async def _run() -> None:
            await handle_booking_created(env, job.booking_created, trace_id)

        await run_claimed(queue, trace_id, outbox_id, _run)
        return
    if queue == QUEUE_BOOKING_CANCELLED:
        env = read_env()
        outbox_id = str(_root(job.booking_cancelled.outboxId))

        async def _run() -> None:
            await handle_booking_cancelled(env, job.booking_cancelled, trace_id)

        await run_claimed(queue, trace_id, outbox_id, _run)
        return
    if queue == QUEUE_DEMO_REFRESH:
        # A failure escapes as a 500 so QStash retries.
        try:
            await handle_demo_refresh()
        except Exception as err:
            logx.error(err, {"queue": queue})
            raise
        return
    if queue == QUEUE_OUTBOX_SWEEP:
        # Outbox sweeper: re-publishes pending notification rows that
        # the inline publish missed. A failure escapes as a 500 so
        # QStash retries the sweep.
        try:
            await handle_outbox_sweep()
        except Exception as err:
            logx.error(err, {"queue": queue})
            raise
        return
    raise UnknownJobQueueError(queue)
