"""Booking routes: the guest write paths (ADR-002) and the organizer's
cabinet-side cancel.

The handlers lean on the exception hierarchy: guards and
decoders raise (TicketExpired, PayloadTooLarge, ValidationFailed), the
db layer raises ApiError subclasses, and the app-level handler renders
them — no per-handler `except Exception` + mapper plumbing.
The shared preamble (rate limit → body → decode → identity)
is a set of FastAPI dependencies (web/deps.py) declared in the
handler signature; FastAPI resolves them in declaration order, which
pins the order of side effects (a validation failure must not consume
the guest ticket).
"""

from __future__ import annotations

import asyncio

from fastapi import Depends
from starlette.background import BackgroundTask
from starlette.requests import Request
from starlette.responses import Response as StarletteResponse

from .. import logx
from ..contracts import models_gen as gen
from ..contracts.payloads import AuthTicketPayload
from ..db.booking_reads import list_guest_bookings
from ..db.booking_writes import (
    CreateBookingData,
    cancel_guest_booking_by_token,
    cancel_owned_booking,
    create_guest_booking,
)
from ..db.outbox import OutboxRow, mark_outbox_sent, mark_outbox_skipped
from ..errors import BookingNotFound
from ..queue import PublishSkipped, publish_outbox
from ..validation.decode import (
    decode_cancel_booking_by_organizer_input,
    decode_cancel_booking_by_token_input,
    decode_create_booking_input,
    decode_lookup_bookings_input,
)
from ..web import json_response
from ..web.deps import (
    ValidatedBody,
    decoded,
    guest_identity,
    ip_rate_limit,
)
from ..web.guards import require_writable_organizer

# publishBudget bounds the inline outbox publish that runs after the
# booking/cancel transaction commits: the response is already flushed,
# so this is best-effort — the sweeper re-publishes anything the budget
# cuts short.
_PUBLISH_BUDGET_SECONDS = 1.5

# The mark-sent runs on its own deadline: it must not be cancelled by
# the publish budget, and its failure must not fail anything (the
# sweeper's dedup id makes a re-publish harmless).
_MARK_DEADLINE_SECONDS = 5.0

# Shared decode dependencies: one instance per route, reused by the
# handler parameter and the identity dependency so FastAPI's per-request
# cache decodes the body exactly once.
_create_booking_dep = decoded(decode_create_booking_input)
_lookup_bookings_dep = decoded(decode_lookup_bookings_input)
_cancel_by_token_dep = decoded(decode_cancel_booking_by_token_input)
_cancel_by_organizer_dep = decoded(decode_cancel_booking_by_organizer_input)


async def publish_outbox_rows(rows: list[OutboxRow], trace_id: str) -> None:
    """The shared after-commit publish: each outbox row written in the
    booking transaction is published to its queue with the row id as the
    dedup id, then marked `sent` on success (or `skipped` on a
    deliberate dev skip) so the sweeper never re-publishes a delivered
    row. Publish errors are absorbed (the booking is already committed)
    — the row stays `pending` and the sweeper retries it.

    Publishes run concurrently on the async transport, each row on the
    shared budget — asyncio.timeout can cancel the async httpx call, so
    a slow QStash cannot hold the response. Marking stays sequential on
    its own deadline."""
    if not rows:
        return
    try:
        async with asyncio.timeout(_PUBLISH_BUDGET_SECONDS):
            outcomes = await asyncio.gather(
                *(_publish_one(row, trace_id) for row in rows), return_exceptions=True
            )
    except TimeoutError:
        # The budget cut the batch short — the rows stay `pending` and
        # the sweeper retries them (its dedup id makes that harmless).
        logx.warn("inline publish budget exhausted", {"traceId": trace_id})
        return
    for row, outcome in zip(rows, outcomes, strict=True):
        if outcome is None:
            await _mark_outbox_terminal(row.id, trace_id, False)
        elif isinstance(outcome, PublishSkipped):
            await _mark_outbox_terminal(row.id, trace_id, True)
        else:
            logx.error(
                outcome if isinstance(outcome, BaseException) else RuntimeError(str(outcome)),
                {
                    "queue": row.queue,
                    "outboxId": row.id,
                    "traceId": trace_id,
                    "source": "inline-publish",
                },
            )
            # stays pending — the sweeper retries


async def _publish_one(row: OutboxRow, trace_id: str) -> None:
    """One outbox row's publish on the async transport."""
    await publish_outbox(row.queue, row.payload, row.id, trace_id)


async def _mark_outbox_terminal(id: str, trace_id: str, skipped: bool) -> None:
    """Record the inline-publish outcome on its own deadline: the
    publish budget may already be expired, and an unbounded context
    would keep the function alive past its budget on a slow DB.
    skipped = the dev-skip sentinel (honest terminal state), otherwise
    sent."""
    source = "inline-mark-skipped" if skipped else "inline-mark-sent"
    try:
        async with asyncio.timeout(_MARK_DEADLINE_SECONDS):
            if skipped:
                await mark_outbox_skipped(id)
            else:
                await mark_outbox_sent(id)
    except Exception as err:
        logx.error(err, {"outboxId": id, "traceId": trace_id, "source": source})


async def booking_create(
    request: Request,
    _limited: None = Depends(ip_rate_limit("rl:booking:", 5, 60.0)),
    body: ValidatedBody[gen.CreateBookingInput] = Depends(_create_booking_dep),
    identity: AuthTicketPayload = Depends(
        guest_identity(_create_booking_dep, lambda m: str(m.guestTicket))
    ),
) -> StarletteResponse:
    """POST /api/bookings: a guest reserves seats (ADR-002). The public
    write of the whole product, and the only one with no session:
    authorization is the short-lived ticket from
    /api/auth/telegram-guest, consumed here — which is what makes a
    replayed request fail rather than double-book. Only guestName, the
    slot and the options come from the body; the identity stored on the
    row is read from the ticket server-side (invariant 8). Seats are
    claimed by the atomic reserve in create_guest_booking (invariant 2)."""
    payload = body.model

    # Trace id: correlates this request across the async pipeline — the
    # id travels in the QStash message header and is emitted in every
    # log line in both the API handler and the job handler, so debugging
    # "I booked but didn't get a message" becomes a grep for one id.
    trace_id = logx.new_trace_id()

    created, outbox = await create_guest_booking(
        CreateBookingData(
            service_id=str(payload.serviceId),
            time_slot_id=str(payload.timeSlotId),
            seats=int(payload.seats),
            guest_name=str(payload.guestName),
            selected_options=(
                [str(o) for o in payload.selectedOptions]
                if payload.selectedOptions is not None
                else None
            ),
            # decode_create_booking_input applies the schema default,
            # so the value is never None here; the fallback is
            # belt-and-braces.
            guest_locale=str(payload.guestLocale or "en"),
            guest=identity,
            trace_id=trace_id,
        )
    )

    logx.info("booking created", {"traceId": trace_id, "bookingId": str(created.id)})

    # After-commit publish (ADR-012): the QStash round trip runs as a
    # response background task — the guest does not wait for QStash, and
    # the publisher absorbs its own errors (the booking is already in).
    star = json_response(201, gen.GuestBookingEnvelope(booking=created)).to_starlette()
    star.background = BackgroundTask(publish_outbox_rows, outbox, trace_id)
    return star


async def booking_lookup(
    request: Request,
    _limited: None = Depends(ip_rate_limit("rl:lookup:", 10, 60.0)),
    body: ValidatedBody[gen.LookupBookingsInput] = Depends(_lookup_bookings_dep),
    identity: AuthTicketPayload = Depends(
        guest_identity(_lookup_bookings_dep, lambda m: str(m.guestTicket))
    ),
) -> StarletteResponse:
    """POST /api/bookings/lookup: "find my bookings" (ADR-002, entry path
    2). The fallback for a guest who lost the deep link: re-authenticate
    with the widget, get every booking of that messenger identity, each
    carrying its own manageToken. POST despite being a read: the ticket
    is a secret that must not land in a URL, and redeeming it mutates
    server state (single-use). The identity comes only from the ticket —
    a raw messengerId in the body would turn this into a way to read
    anyone's bookings."""
    bookings = await list_guest_bookings(identity.messenger, identity.messenger_id)
    if bookings is None:
        bookings = []
    return json_response(200, gen.GuestBookingsEnvelope(bookings=bookings)).to_starlette()


async def booking_cancel(
    request: Request,
    _limited: None = Depends(ip_rate_limit("rl:cancel:", 10, 60.0)),
    body: ValidatedBody[gen.CancelBookingByTokenInput] = Depends(_cancel_by_token_dep),
) -> StarletteResponse:
    """POST /api/bookings/cancel: the guest cancels via their
    manageToken (ADR-002). The token is the credential: it reached the
    guest through their verified messenger account, so possession is
    proof of ownership and no session is involved. It travels in the
    body rather than the URL so it stays out of access logs, Referer
    headers and browser history. POST rather than DELETE: cancelling
    moves the booking to cancelled and releases the seats (invariant 1),
    and the response is the updated booking."""
    trace_id = logx.new_trace_id()

    cancelled = await cancel_guest_booking_by_token(str(body.model.manageToken), trace_id)
    # Unknown token — answered exactly like a wrong one, so the endpoint
    # cannot be used to test whether a token exists.
    if cancelled is None:
        raise BookingNotFound()
    booking, outbox = cancelled

    logx.info(
        "booking cancelled by guest",
        {"traceId": trace_id, "bookingId": str(booking.id)},
    )

    # After-commit notification (ADR-012): the organizer is told by
    # QStash delivery once the cancellation is durable; the publisher
    # never throws. The publish runs as a response background task —
    # the guest does not wait for QStash.
    star = json_response(200, gen.GuestBookingEnvelope(booking=booking)).to_starlette()
    star.background = BackgroundTask(publish_outbox_rows, outbox, trace_id)
    return star


async def booking_cancel_by_organizer(
    request: Request,
    # Also refuses the demo account and anonymous cabinet visitors,
    # since /cabinet needs no session (ADR-010) — a route under it does
    # not imply an authenticated organizer.
    organizer_id: str = Depends(require_writable_organizer),
    body: ValidatedBody[gen.CancelBookingByOrganizerInput] = Depends(_cancel_by_organizer_dep),
) -> StarletteResponse:
    """POST /api/bookings/cancel-by-organizer: the organizer cancels a
    booking on one of their own services from the cabinet. Sibling of
    booking_cancel, kept separate because the credential differs: that
    one is authorized by the guest's manageToken and takes no session;
    this one by the organizer's session plus ownership of the service
    the booking hangs off. Folding both into one handler would mean a
    body that accepts either secret, and an endpoint that cancels on
    whichever it finds — the kind of branch where a missing check turns
    into cancelling someone else's booking."""
    trace_id = logx.new_trace_id()

    cancelled = await cancel_owned_booking(organizer_id, str(body.model.bookingId), trace_id)
    # Unknown id and a booking on someone else's service are answered
    # identically, so the endpoint cannot probe for foreign ids.
    if cancelled is None:
        raise BookingNotFound()
    booking, outbox = cancelled

    logx.info(
        "booking cancelled by organizer",
        {"traceId": trace_id, "bookingId": str(booking.id)},
    )

    star = json_response(200, gen.BookingEnvelope(booking=booking)).to_starlette()
    star.background = BackgroundTask(publish_outbox_rows, outbox, trace_id)
    return star
