"""Booking service — the guest booking flow's reads and writes
(ADR-002) plus the cabinet-side cancel.

Seats move only through the atomic reserve below; the demo guard runs
inside the transaction because the guest routes carry no session — the
organizer is only known once the slot joins its service.

Boundary: every function takes the caller's AsyncSession and returns
detached Row chains (db/rows.BookingChain), never wire DTOs — the route
serializes via db/serializers.py, and notification jobs consume the same
chain for its non-wire fields (chat id, manage token, timezone).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.ticket import consume_guest_ticket
from ..contracts import domain
from ..contracts.constants_gen import QUEUE_BOOKING_CANCELLED, QUEUE_BOOKING_CREATED
from ..db.rows import (
    BookingChain,
    OutboxRow,
    from_model_booking,
    from_model_organizer,
    from_model_service,
    from_model_slot,
)
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
from ..repositories import booking_repo, slot_repo
from .outbox_service import enqueue_outbox_tx

# How long after the slot starts the manageToken stays usable. A guest
# may need to cancel shortly after the session begins (ran late, wrong
# day); 24h covers that without making the token permanent.
MANAGE_TOKEN_GRACE_PERIOD = timedelta(hours=24)


@dataclass(slots=True, frozen=True)
class CreateBookingData:
    """The validated booking input plus the *raw* guest ticket, carried
    into the booking transaction (hand-written request plumbing, not a
    wire type). The ticket is redeemed inside create_guest_booking —
    after every domain refusal — so a refused attempt leaves it
    reusable (ADR-024 B1)."""

    service_id: str
    time_slot_id: str
    seats: int
    guest_name: str
    selected_options: list[str] | None
    guest_locale: str
    guest_ticket: str
    trace_id: str


async def list_guest_bookings(
    session: AsyncSession, messenger: str, messenger_id: str
) -> list[BookingChain]:
    """Every booking of one messenger identity, newest first (ADR-002,
    entry path 2). Cancelled bookings are included: a guest looking for
    "my bookings" is often checking whether a cancellation went through.
    Expired manageTokens stay listed too (the DTO marks them
    canCancel=false): dropping the row would silently erase the guest's
    booking history 24h after the slot, and the caller of this endpoint
    *is* the owner of the identity, so the expired token is not a leak."""
    async with session.begin():
        chains = await booking_repo.list_guest_bookings(session, messenger, messenger_id)
    return [
        (
            from_model_booking(b),
            from_model_slot(slot),
            from_model_service(service),
            from_model_organizer(organizer),
        )
        for b, slot, service, organizer in chains
    ]


async def get_booking_chain(session: AsyncSession, booking_id: str) -> BookingChain | None:
    """The fresh chain a notification job refetches at send time (jobs
    carry ids only). Raw rows, not DTOs: a notification needs the
    timezone, chat id, manageToken and display overrides."""
    async with session.begin():
        chain = await booking_repo.get_booking_chain_by_id(session, booking_id)
    if chain is None:
        return None
    b, slot, service, organizer = chain
    return (
        from_model_booking(b),
        from_model_slot(slot),
        from_model_service(service),
        from_model_organizer(organizer),
    )


async def get_guest_booking_by_token(session: AsyncSession, token: str) -> BookingChain | None:
    """Lookup a guest booking's chain by raw manageToken. Checks
    manage_token_hash and expiry — an expired token answers like an
    unknown one so the endpoint cannot probe for token existence."""
    token_hash = hash_manage_token(token)
    async with session.begin():
        chain = await booking_repo.get_chain_by_manage_token_hash(session, token_hash)
    if chain is None:
        return None
    b, slot, service, organizer = chain
    # Expired token is refused on lookup (ADR-020)
    now = datetime.now(UTC)
    if b.manage_token_expires_at is not None and b.manage_token_expires_at <= now:
        return None
    return (
        from_model_booking(b),
        from_model_slot(slot),
        from_model_service(service),
        from_model_organizer(organizer),
    )


async def create_guest_booking(
    session: AsyncSession, data: CreateBookingData
) -> tuple[BookingChain, list[OutboxRow]]:
    """Reserve seats and insert the confirmed booking — the guest
    booking flow's one write (invariant 2).

    The seat claim is a single conditional UPDATE (booking_repo):
    booked_count moves only when the capacity predicate holds.
    Postgres evaluates the predicate against the row it locks, so two
    concurrent bookings for the last seat cannot both succeed — one
    updates no row and is refused. The booking row is inserted only if
    that statement affected a row, and both live in one transaction: a
    claimed seat with no booking would be capacity lost forever, and a
    booking with no claim is an overbooking.

    The second return value is the outbox rows written in the same
    transaction: the caller publishes them inline after commit and marks
    each `sent` on success, so the sweeper never re-publishes a delivered
    row."""
    async with session.begin():
        # A slot in the past is not bookable: the UI filters them out,
        # but the API must not rely on that — knowing the id must not
        # let anyone book a session that already started (its
        # manageToken would be born expired). The predicate lives in
        # the chain-select, so a past slot is answered exactly like a
        # missing one: SlotGone → 404 slotGone.
        models = await slot_repo.get_slot_chain_for_booking(
            session, data.time_slot_id, data.service_id
        )
        if models is None:
            raise SlotGone()
        slot_model, service_model, organizer_model = models
        slot, service, organizer = (
            from_model_slot(slot_model),
            from_model_service(service_model),
            from_model_organizer(organizer_model),
        )

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
        # reserve so an oversized party is refused outright rather than
        # competing for seats.
        if data.seats > service.max_seats_per_booking:
            raise PartyTooLarge(service.max_seats_per_booking)

        claimed_model = await booking_repo.atomic_reserve_seats(
            session, data.time_slot_id, data.seats
        )
        if claimed_model is None:
            # No row claimed → sold out. seats_left is computed from the
            # chain-select snapshot (tx start) — under READ COMMITTED a
            # concurrent booking committed in between can make it stale
            # by a seat or two. Exact TS parity (it read the same
            # snapshot), and the number is UX copy, not an invariant.
            raise SoldOut(domain.seats_left(slot.capacity, slot.booked_count))
        claimed = from_model_slot(claimed_model)

        # The guest ticket is spent here — after every refusal that a
        # retry could fix (gone slot, invalid options, party cap, sold
        # out) and only once a booking is genuinely attempted (ADR-024
        # B1). An expired/foreign-purpose ticket raises TicketExpired;
        # the transaction rolls back and the claimed seat is released.
        guest = await consume_guest_ticket(data.guest_ticket)

        # manageToken expiry: the token is usable until the slot starts
        # plus a grace period — a past event's booking does not need
        # cancel access.
        expires_at = claimed.starts_at + MANAGE_TOKEN_GRACE_PERIOD
        token = new_manage_token()
        try:
            created_model = await booking_repo.create_booking(
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
        except Exception as err:
            # Duplicate booking — the transaction rolls back, releasing
            # the claimed seat (partial unique index, invariant 4).
            if unique_violation(err):
                raise DuplicateBooking() from err
            raise
        created = from_model_booking(created_model)

        # Transactional outbox: write one outbox row per recipient in
        # the same transaction, so a crash between commit and the inline
        # publish does not lose the notification — the sweeper
        # re-publishes pending rows. The rows travel back to the caller,
        # which owns the inline delivery and the `sent` marking.
        outbox: list[OutboxRow] = []
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

    return (created, claimed, service, organizer), outbox


async def cancel_guest_booking_by_token(
    session: AsyncSession, token: str, trace_id: str
) -> tuple[BookingChain, list[OutboxRow]] | None:
    """Cancel by manageToken and release the seats (ADR-002). Status
    flip and bookedCount decrement happen in one transaction — invariant
    1: the counter equals the seats held by confirmed bookings. The
    status='confirmed' predicate makes this idempotent under a
    double-tap: the second call updates no row and is reported as
    already cancelled instead of decrementing twice.

    Returns None for an unknown token (caller answers 404 without
    confirming whether the token exists)."""
    async with session.begin():
        # Credential check goes through the hash: the raw token column
        # is not a lookup key anymore.
        models = await booking_repo.get_chain_by_manage_token_hash(
            session, hash_manage_token(token)
        )
        if models is None:
            return None
        booking_model, slot_model, service_model, organizer_model = models
        b = from_model_booking(booking_model)
        slot, service, organizer = (
            from_model_slot(slot_model),
            from_model_service(service_model),
            from_model_organizer(organizer_model),
        )

        refuse_demo_write(organizer.id)

        # manageToken expiry: a token past its expiry is answered like an
        # unknown one (None → 404) so the endpoint cannot be used to
        # test whether a token exists. None = non-expiring (legacy rows
        # created before the column was added).
        if b.manage_token_expires_at is not None and datetime.now(UTC) > b.manage_token_expires_at:
            raise BookingNotFound()

        cancelled_model = await booking_repo.cancel_booking_mark(session, b.id)
        if cancelled_model is None:
            raise AlreadyCancelled()
        cancelled = from_model_booking(cancelled_model)

        released_model = await booking_repo.release_seats_returning(
            session, cancelled.time_slot_id, cancelled.seats
        )
        # released can't vanish while the booking points at it.
        released = from_model_slot(released_model) if released_model is not None else slot

        # Transactional outbox: the organizer is notified of the guest's
        # cancellation. One row — the counterparty only (ADR-012). The
        # row travels back to the caller for the inline publish + `sent`
        # marking.
        outbox_row = await enqueue_outbox_tx(
            session,
            QUEUE_BOOKING_CANCELLED,
            lambda outbox_id: {
                "bookingId": cancelled.id,
                "cancelledBy": "guest",
                "outboxId": outbox_id,
            },
            trace_id,
        )

    return (cancelled, released, service, organizer), [outbox_row]


async def cancel_owned_booking(
    session: AsyncSession, organizer_id: str, booking_id: str, trace_id: str
) -> tuple[BookingChain, list[OutboxRow]] | None:
    """The cabinet counterpart of cancel_guest_booking_by_token: same
    state transition and seat release, reached by a different
    credential. The organizer proves ownership by owning the service the
    booking hangs off, so the id is scoped through the owned-services
    chain. The returned chain lets the caller project the organizer's
    DTO (which drops manageToken: the cabinet must never receive it,
    even as a side effect) and invalidate the public slot's cache."""
    refuse_demo_write(organizer_id)

    async with session.begin():
        # Unknown id and a booking on someone else's service are
        # answered identically, so the endpoint cannot probe for foreign
        # ids.
        chain = await booking_repo.get_owned_booking_chain(session, organizer_id, booking_id)
        if chain is None:
            return None
        booking_model, slot_model, service_model, organizer_model = chain
        target = from_model_booking(booking_model)

        cancelled_model = await booking_repo.cancel_booking_mark(session, target.id)
        if cancelled_model is None:
            raise AlreadyCancelled()
        cancelled = from_model_booking(cancelled_model)

        released_model = await booking_repo.release_seats_returning(
            session, cancelled.time_slot_id, cancelled.seats
        )
        released = (
            from_model_slot(released_model)
            if released_model is not None
            else from_model_slot(slot_model)
        )

        # Transactional outbox: the guest is notified of the organizer's
        # cancellation. One row — the counterparty only (ADR-012). The
        # row travels back to the caller for the inline publish + `sent`
        # marking.
        outbox_row = await enqueue_outbox_tx(
            session,
            QUEUE_BOOKING_CANCELLED,
            lambda outbox_id: {
                "bookingId": cancelled.id,
                "cancelledBy": "organizer",
                "outboxId": outbox_id,
            },
            trace_id,
        )

    return (
        cancelled,
        released,
        from_model_service(service_model),
        from_model_organizer(organizer_model),
    ), [outbox_row]
