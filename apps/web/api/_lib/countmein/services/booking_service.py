"""Booking service — the guest booking flow's write (ADR-002) plus the
two cancels.

Seats move only through the atomic reserve below; the demo guard runs
inside the transaction because the guest routes carry no session — the
organizer is only known once the slot joins its service.

Boundary: functions take the caller's AsyncSession and return ORM-model
chains (repositories.booking_repo.BookingChain), never wire DTOs — the
route serializes via db/serializers.py; notification jobs consume the
same chain for its non-wire fields (chat id, manage token, timezone).
Reads with no business rule (list/lookup) live in the repositories —
routes and jobs call them directly.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.ticket import consume_guest_ticket
from ..contracts import domain
from ..contracts.constants_gen import QUEUE_BOOKING_CANCELLED, QUEUE_BOOKING_CREATED
from ..db.shared import hash_manage_token, new_id, new_manage_token, unique_violation
from ..demo import refuse_demo_write
from ..errors import (
    AlreadyCancelled,
    BookingNotFound,
    DuplicateBooking,
    InvalidOptions,
    PartyTooLarge,
    SlotGone,
    SoldOut,
)
from ..models.outbox import OutboxMessage
from ..repositories import booking_repo, slot_repo
from ..repositories.booking_repo import BookingChain
from .outbox_service import enqueue_outbox_tx

# manageToken stays usable this long after the slot starts (a guest may
# cancel shortly after it begins); 24h without making it permanent.
MANAGE_TOKEN_GRACE_PERIOD = timedelta(hours=24)


@dataclass(slots=True, frozen=True)
class CreateBookingData:
    """Validated booking input plus the *raw* guest ticket, carried into
    the booking transaction (request plumbing, not a wire type). The
    ticket is redeemed inside create_guest_booking — after every domain
    refusal — so a refused attempt leaves it reusable (ADR-024 B1)."""

    service_id: str
    time_slot_id: str
    seats: int
    guest_name: str
    selected_options: list[str] | None
    guest_locale: str
    guest_ticket: str
    trace_id: str


async def create_guest_booking(
    session: AsyncSession, data: CreateBookingData
) -> tuple[BookingChain, list[OutboxMessage]]:
    """Reserve seats and insert the confirmed booking — the guest
    booking flow's one write (invariant 2).

    The seat claim is a single conditional UPDATE (booking_repo):
    booked_count moves only when the capacity predicate holds on the
    locked row, so two concurrent bookings for the last seat cannot both
    succeed. The booking row is inserted only if that statement affected
    a row, in the same transaction: a claimed seat with no booking is
    capacity lost forever, a booking with no claim is an overbooking.

    The second return value is the outbox rows written in the same
    transaction: the caller publishes them inline after commit and marks
    each `sent` on success, so the sweeper never re-publishes a delivered
    row."""
    async with session.begin():
        # A past slot is not bookable even if the id is known (its
        # manageToken would be born expired). The predicate lives in the
        # chain-select, so a past slot answers exactly like a missing
        # one: SlotGone → 404 slotGone.
        models = await slot_repo.get_slot_chain_for_booking(
            session, data.time_slot_id, data.service_id
        )
        if models is None:
            raise SlotGone()
        slot, service, organizer = models

        refuse_demo_write(organizer.id)

        mode = "multi"
        if service.options_select_mode == "single":
            mode = "single"
        try:
            selected = domain.validate_selected_options(
                service.options or [], mode, data.selected_options or []
            )
        except ValueError as err:
            raise InvalidOptions(str(err)) from err

        # Organizer's per-booking cap — enforced before the atomic
        # reserve so an oversized party is refused outright.
        if data.seats > service.max_seats_per_booking:
            raise PartyTooLarge(service.max_seats_per_booking)

        claimed = await booking_repo.atomic_reserve_seats(session, data.time_slot_id, data.seats)
        if claimed is None:
            # No row claimed → sold out. seats_left comes from the
            # chain-select snapshot (tx start) and can be stale by a
            # seat or two under READ COMMITTED — UX copy, not an
            # invariant.
            raise SoldOut(domain.seats_left(slot.capacity, slot.booked_count))

        # The guest ticket is spent here — after every retryable
        # refusal (gone slot, invalid options, party cap, sold out) and
        # only once a booking is genuinely attempted (ADR-024 B1). An
        # expired/foreign-purpose ticket raises TicketExpired; the tx
        # rolls back and the claimed seat is released.
        guest = await consume_guest_ticket(data.guest_ticket)

        # manageToken usable until slot start + grace — a past event's
        # booking needs no cancel access.
        expires_at = claimed.starts_at + MANAGE_TOKEN_GRACE_PERIOD
        token = new_manage_token()
        try:
            created = await booking_repo.create_booking(
                session,
                {
                    "id": new_id(),
                    "time_slot_id": claimed.id,
                    "status": "confirmed",
                    "seats": data.seats,
                    "guest_name": data.guest_name,
                    "guest_messenger": guest.messenger,
                    "guest_messenger_id": guest.messenger_id,
                    "guest_messenger_login": guest.messenger_login,
                    "guest_locale": data.guest_locale,
                    "manage_token": token,
                    "manage_token_hash": hash_manage_token(token),
                    "selected_options": selected,
                    "manage_token_expires_at": expires_at,
                },
            )
        except IntegrityError as err:
            # Duplicate booking — the transaction rolls back, releasing
            # the claimed seat (partial unique index, invariant 4).
            if unique_violation(err):
                raise DuplicateBooking() from err
            raise

        # Transactional outbox: one row per recipient in the same tx, so
        # a crash between commit and the inline publish loses nothing —
        # the sweeper re-publishes pending rows. Rows travel back to the
        # caller, which owns the inline delivery and `sent` marking.
        outbox: list[OutboxMessage] = []
        for recipient in ("organizer", "guest"):
            row = await enqueue_outbox_tx(
                session,
                QUEUE_BOOKING_CREATED,
                lambda outbox_id, r=recipient: {  # type: ignore[misc]
                    "bookingId": created.id,
                    "recipient": r,
                    "outboxId": outbox_id,
                },
                data.trace_id,
            )
            outbox.append(row)

    return BookingChain(created, claimed, service, organizer), outbox


async def _cancel_tx(
    session: AsyncSession,
    chain: BookingChain,
    cancelled_by: str,
    trace_id: str,
) -> tuple[BookingChain, OutboxMessage]:
    """The shared cancel transition, inside the caller's transaction:
    confirmed→cancelled mark → seat release → outbox row for the
    counterparty (ADR-012). The status='confirmed' predicate makes the
    mark idempotent under a double-tap — the second call updates no row
    and reports AlreadyCancelled instead of decrementing twice."""
    refuse_demo_write(chain.organizer.id)

    cancelled = await booking_repo.cancel_booking_mark(session, chain.booking.id)
    if cancelled is None:
        raise AlreadyCancelled()

    released = await booking_repo.release_seats_returning(
        session, cancelled.time_slot_id, cancelled.seats
    )
    # The slot can't vanish while the booking points at it; fall back to
    # the chain's snapshot for the DTO if RETURNING ever came back empty.
    if released is None:
        released = chain.slot

    outbox_row = await enqueue_outbox_tx(
        session,
        QUEUE_BOOKING_CANCELLED,
        lambda outbox_id: {
            "bookingId": cancelled.id,
            "cancelledBy": cancelled_by,
            "outboxId": outbox_id,
        },
        trace_id,
    )
    return BookingChain(cancelled, released, chain.service, chain.organizer), outbox_row


async def cancel_guest_booking_by_token(
    session: AsyncSession, token: str, trace_id: str
) -> tuple[BookingChain, list[OutboxMessage]] | None:
    """Cancel by manageToken and release the seats (ADR-002). Status
    flip and bookedCount decrement happen in one transaction — invariant
    1: the counter equals seats held by confirmed bookings.

    Returns None for an unknown token (caller answers 404 without
    confirming whether the token exists)."""
    async with session.begin():
        # Credential check via the hash — the raw token column is no
        # longer a lookup key.
        chain = await booking_repo.get_chain_by_manage_token_hash(session, hash_manage_token(token))
        if chain is None:
            return None

        # An expired token answers like an unknown one (→ 404) so the
        # endpoint cannot probe token existence. NULL = non-expiring
        # (legacy rows predating the column).
        if domain.manage_token_expired(chain.booking.manage_token_expires_at):
            raise BookingNotFound()

        result, outbox_row = await _cancel_tx(session, chain, "guest", trace_id)

    return result, [outbox_row]


async def cancel_owned_booking(
    session: AsyncSession, organizer_id: str, booking_id: str, trace_id: str
) -> tuple[BookingChain, list[OutboxMessage]] | None:
    """Cabinet counterpart of cancel_guest_booking_by_token: same state
    transition and seat release, different credential — the organizer's
    ownership of the service the booking hangs off. The returned chain
    lets the caller project the organizer's DTO (drops manageToken — the
    cabinet must never receive it) and invalidate the slot's cache."""
    refuse_demo_write(organizer_id)

    async with session.begin():
        # Unknown id and a foreign booking answer identically — no
        # probing for other organizers' ids.
        chain = await booking_repo.get_owned_booking_chain(session, organizer_id, booking_id)
        if chain is None:
            return None

        result, outbox_row = await _cancel_tx(session, chain, "organizer", trace_id)

    return result, [outbox_row]
