"""Booking routes: the guest write paths (ADR-002) and the organizer's
cabinet-side cancel.

Handlers lean on the exception hierarchy: guards and decoders raise
(TicketExpired, PayloadTooLarge, ValidationFailed), services raise
ApiError subclasses, and the app-level handler renders them — no
per-handler `except Exception` plumbing. The shared preamble (rate
limit → body → decode → identity) is FastAPI dependencies
(web/deps.py) resolved in declaration order, pinning side-effect order
(a validation failure must not consume the guest ticket).

Service functions return detached ORM-model chains
(repositories.booking_repo.BookingChain); this module projects them to
wire DTOs via db/serializers.py — the boundary that keeps manageToken
out of organizer-facing answers by construction.
"""

from __future__ import annotations

import asyncio
from typing import Annotated

from fastapi import Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask, BackgroundTasks
from starlette.responses import Response as StarletteResponse

from .. import logx
from ..contracts import domain
from ..contracts import models_gen as gen
from ..contracts.payloads import AuthTicketPayload
from ..db.client import sessionmaker
from ..db.serializers import to_booking_record, to_guest_booking_chain
from ..db.shared import hash_manage_token
from ..errors import BookingNotFound
from ..models.outbox import OutboxMessage
from ..queue import PublishSkipped, publish_outbox
from ..repositories import booking_repo
from ..repositories.booking_repo import BookingChain
from ..services import booking_service
from ..services.outbox_service import settle_publish
from ..validation.decode import (
    decode_cancel_booking_by_organizer_input,
    decode_create_booking_input,
    decode_lookup_bookings_input,
    decode_manage_token_input,
)
from ..web import json_response
from ..web.deps import (
    ValidatedBody,
    cabinet_organizer,
    decoded,
    get_db_session,
    guest_identity,
    guest_ticket,
    ip_rate_limit,
)
from ..web.guards import require_writable_organizer
from ..web.revalidate import public_tags, trigger_revalidation

# Bounds the inline outbox publish after the booking/cancel commit:
# the response is already flushed, so this is best-effort — the sweeper
# re-publishes what the budget cuts short.
_PUBLISH_BUDGET_SECONDS = 1.5

# Mark-sent runs on its own deadline: it must outlive the publish
# budget, and its failure must not fail anything (the dedup id makes a
# re-publish harmless).
_MARK_DEADLINE_SECONDS = 5.0

# Shared decode dependencies: one instance per route, reused by handler
# and identity dependencies so FastAPI's per-request cache decodes the
# body exactly once.
_create_booking_dep = decoded(decode_create_booking_input)
_lookup_bookings_dep = decoded(decode_lookup_bookings_input)
_manage_token_dep = decoded(decode_manage_token_input)
_cancel_by_organizer_dep = decoded(decode_cancel_booking_by_organizer_input)


def _chain_tags(chain: BookingChain) -> list[str]:
    """Public-cache tags a booking mutation dirties: bookedCount changed
    on the organizer's public page and the standalone service page."""
    return public_tags(organizer_slug=chain.organizer.slug, service_id=chain.service.id)


def _attach_followups(
    star: StarletteResponse,
    chain: BookingChain,
    outbox: list[OutboxMessage],
    trace_id: str,
) -> StarletteResponse:
    """Attach after-commit work to the response: QStash publish and
    Next.js cache invalidation as background tasks — the caller waits
    for neither, each absorbs its own errors (already committed)."""
    star.background = BackgroundTasks(
        [
            BackgroundTask(publish_outbox_rows, outbox, trace_id),
            BackgroundTask(trigger_revalidation, _chain_tags(chain)),
        ]
    )
    return star


async def publish_outbox_rows(rows: list[OutboxMessage], trace_id: str) -> None:
    """Shared after-commit publish: each outbox row is published to its
    queue with the row id as dedup id, then settled `sent` (or `skipped`
    on a deliberate dev skip) so the sweeper never re-publishes it.
    Publish errors are absorbed (already committed) — the row stays
    `pending` and the sweeper retries.

    Publishes run concurrently on the shared budget — asyncio.timeout
    can cancel the httpx call, so a slow QStash cannot hold the
    response. Marking stays sequential on its own deadline."""
    if not rows:
        return
    try:
        async with asyncio.timeout(_PUBLISH_BUDGET_SECONDS):
            outcomes = await asyncio.gather(
                *(
                    publish_outbox(row.queue, row.payload, row.id, row.trace_id or "")
                    for row in rows
                ),
                return_exceptions=True,
            )
    except TimeoutError:
        # Budget cut the batch short — rows stay `pending`, the sweeper
        # retries (dedup id makes that harmless).
        logx.warn("inline publish budget exhausted", {"traceId": trace_id})
        return
    for row, outcome in zip(rows, outcomes, strict=True):
        # gather return_exceptions=True yields only BaseException|None.
        err = outcome if isinstance(outcome, BaseException) else None
        if err is not None and not isinstance(err, PublishSkipped):
            logx.error(
                err,
                {
                    "queue": row.queue,
                    "outboxId": row.id,
                    "traceId": trace_id,
                    "source": "inline-publish",
                },
            )
            continue  # stays pending — the sweeper retries
        await _settle_outbox_row(row.id, err, trace_id)


async def _settle_outbox_row(row_id: str, outcome: BaseException | None, trace_id: str) -> None:
    """Record the inline-publish outcome on its own deadline — the
    publish budget may already be expired. Worker context: the request's
    session is closed, so this owns a fresh one."""
    try:
        async with asyncio.timeout(_MARK_DEADLINE_SECONDS):
            async with sessionmaker()() as session, session.begin():
                await settle_publish(session, row_id, outcome)
    except Exception as err:
        logx.error(err, {"outboxId": row_id, "traceId": trace_id, "source": "inline-settle"})


async def bookings_list(
    scope: tuple[str, bool] = Depends(cabinet_organizer),
    session: AsyncSession = Depends(get_db_session),
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> StarletteResponse:
    """GET /api/bookings: list the organizer's bookings. Bounds are the
    declared Query params — FastAPI refuses out-of-range values with a
    400."""
    organizer_id, _is_demo = scope

    # Fetch one row past the page so hasMore needs no separate COUNT.
    bookings = await booking_repo.list_by_organizer(
        session, organizer_id, limit=limit + 1, offset=offset
    )
    has_more = len(bookings) > limit
    records = [to_booking_record(b) for b in bookings[:limit]]
    return json_response(200, gen.BookingsEnvelope(bookings=records, hasMore=has_more))


async def booking_create(
    _limited: None = Depends(ip_rate_limit("rl:booking:", 5, 60.0)),
    body: ValidatedBody[gen.CreateBookingInput] = Depends(_create_booking_dep),
    ticket: str = Depends(guest_ticket(_create_booking_dep, lambda m: str(m.guestTicket))),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """POST /api/bookings: a guest reserves seats (ADR-002) — the only
    write with no session. Authorization is the single-use ticket from
    /api/auth/telegram-guest (a replayed request fails rather than
    double-books). The dependency extracts the raw ticket; the service
    redeems it after the domain refusals, so a refused attempt leaves it
    reusable (ADR-024 B1). The stored identity comes from the ticket
    server-side (invariant 8); seats are claimed by the atomic reserve
    (invariant 2)."""
    payload = body.model

    # Trace id travels in the QStash header and every log line of both
    # handlers — "I booked but got no message" becomes a one-id grep.
    trace_id = logx.new_trace_id()

    chain, outbox = await booking_service.create_guest_booking(
        session,
        booking_service.CreateBookingData(
            service_id=str(payload.serviceId),
            time_slot_id=str(payload.timeSlotId),
            seats=int(payload.seats),
            guest_name=str(payload.guestName),
            selected_options=(
                [str(o) for o in payload.selectedOptions]
                if payload.selectedOptions is not None
                else None
            ),
            # decode applies the schema default; the fallback is
            # belt-and-braces.
            guest_locale=str(payload.guestLocale or "en"),
            guest_ticket=ticket,
            trace_id=trace_id,
        ),
    )

    logx.info("booking created", {"traceId": trace_id, "bookingId": chain.booking.id})

    # After-commit work (ADR-012 + ADR-023): QStash publish and cache
    # invalidation as background tasks — the guest waits for neither.
    star = json_response(201, gen.GuestBookingEnvelope(booking=to_guest_booking_chain(chain)))
    return _attach_followups(star, chain, outbox, trace_id)


async def booking_lookup(
    _limited: None = Depends(ip_rate_limit("rl:lookup:", 10, 60.0)),
    body: ValidatedBody[gen.LookupBookingsInput] = Depends(_lookup_bookings_dep),
    identity: AuthTicketPayload = Depends(
        guest_identity(_lookup_bookings_dep, lambda m: str(m.guestTicket))
    ),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """POST /api/bookings/lookup: "find my bookings" (ADR-002, entry
    path 2) — the fallback for a guest who lost the deep link. POST
    despite being a read: the ticket is a secret that must not land in
    a URL, and redeeming it mutates server state (single-use). Identity
    comes only from the ticket — a raw messengerId in the body would
    read anyone's bookings."""
    chains = await booking_repo.list_guest_bookings(
        session, identity.messenger, identity.messenger_id
    )
    bookings = [to_guest_booking_chain(chain) for chain in chains]
    return json_response(200, gen.GuestBookingsEnvelope(bookings=bookings))


async def booking_cancel(
    _limited: None = Depends(ip_rate_limit("rl:cancel:", 10, 60.0)),
    body: ValidatedBody[gen.ManageTokenInput] = Depends(_manage_token_dep),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """POST /api/bookings/cancel: the guest cancels via manageToken
    (ADR-002). The token is the credential — it reached the guest
    through their verified messenger, so possession proves ownership.
    It travels in the body to stay out of logs, Referer headers and
    browser history. POST: cancelling flips status and releases seats
    (invariant 1); the response is the updated booking."""
    trace_id = logx.new_trace_id()

    cancelled = await booking_service.cancel_guest_booking_by_token(
        session, str(body.model.manageToken), trace_id
    )
    # Unknown token answers exactly like a wrong one — no probing.
    if cancelled is None:
        raise BookingNotFound()
    chain, outbox = cancelled

    logx.info(
        "booking cancelled by guest",
        {"traceId": trace_id, "bookingId": chain.booking.id},
    )

    # After-commit notification (ADR-012): the organizer is told by
    # QStash once the cancel is durable; publish and cache invalidation
    # are background tasks — the guest waits for neither.
    star = json_response(200, gen.GuestBookingEnvelope(booking=to_guest_booking_chain(chain)))
    return _attach_followups(star, chain, outbox, trace_id)


async def booking_manage_lookup(
    _limited: None = Depends(ip_rate_limit("rl:manage-lookup:", 10, 60.0)),
    body: ValidatedBody[gen.ManageTokenInput] = Depends(_manage_token_dep),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """POST /api/bookings/manage-lookup: a guest looks up a booking by
    manageToken. The credential check goes through the SHA-256 hash;
    an expired token answers like an unknown one, so the endpoint
    cannot probe token existence (ADR-020)."""
    chain = await booking_repo.get_chain_by_manage_token_hash(
        session, hash_manage_token(str(body.model.manageToken))
    )
    if chain is None or domain.manage_token_expired(chain.booking.manage_token_expires_at):
        raise BookingNotFound()

    return json_response(200, gen.GuestBookingEnvelope(booking=to_guest_booking_chain(chain)))


async def booking_cancel_by_organizer(
    # Refuses the demo account and anonymous cabinet visitors: /cabinet
    # needs no session (ADR-010), so the route implies no auth.
    organizer_id: str = Depends(require_writable_organizer),
    body: ValidatedBody[gen.CancelBookingByOrganizerInput] = Depends(_cancel_by_organizer_dep),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """POST /api/bookings/cancel-by-organizer: the organizer cancels a
    booking on their own service. Sibling of booking_cancel, kept
    separate because the credential differs — the guest's manageToken
    vs. the organizer's session plus service ownership. One merged
    handler accepting either secret would be a branch where a missing
    check cancels someone else's booking."""
    trace_id = logx.new_trace_id()

    cancelled = await booking_service.cancel_owned_booking(
        session, organizer_id, str(body.model.bookingId), trace_id
    )
    # Unknown id and a foreign booking answer identically — no probing.
    if cancelled is None:
        raise BookingNotFound()
    chain, outbox = cancelled

    logx.info(
        "booking cancelled by organizer",
        {"traceId": trace_id, "bookingId": chain.booking.id},
    )

    # The organizer's DTO drops manageToken — project the booking row.
    star = json_response(200, gen.BookingEnvelope(booking=to_booking_record(chain.booking)))
    return _attach_followups(star, chain, outbox, trace_id)
