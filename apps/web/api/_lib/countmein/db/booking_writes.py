"""Booking writes. Seats move only through the atomic reserve below; the
demo guard runs inside the transaction because these routes carry no
session — the organizer is only known once the slot joins its service.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import text

from ..contracts import domain
from ..contracts import models_gen as gen
from ..contracts.payloads import AuthTicketPayload
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
from .client import engine
from .outbox import OutboxRow, enqueue_outbox
from .rows import (
    BOOKING_CHAIN_SELECT,
    BOOKING_COLUMNS,
    SLOT_CHAIN_SELECT,
    SLOT_COLUMNS,
    scan_booking,
    scan_booking_chain,
    scan_slot,
    scan_slot_chain,
    to_booking_record,
    to_guest_booking,
)
from .shared import hash_manage_token, new_id, new_manage_token, unique_violation

# How long after the slot starts the manageToken stays usable. A guest
# may need to cancel shortly after the session begins (ran late, wrong
# day); 24h covers that without making the token permanent.
MANAGE_TOKEN_GRACE_PERIOD = timedelta(hours=24)

# Queue names (ADR-012) — jobs carry ids only.
from ..contracts.constants_gen import (  # noqa: E402
    QUEUE_BOOKING_CANCELLED,
    QUEUE_BOOKING_CREATED,
)


@dataclass(slots=True, frozen=True)
class CreateBookingData:
    """The validated booking input plus the resolved guest identity,
    carried into the booking transaction (hand-written request plumbing,
    not a wire type)."""

    service_id: str
    time_slot_id: str
    seats: int
    guest_name: str
    selected_options: list[str] | None
    guest_locale: str
    guest: AuthTicketPayload
    trace_id: str


async def create_guest_booking(
    data: CreateBookingData,
) -> tuple[gen.GuestBooking, list[OutboxRow]]:
    """Reserve seats and insert the confirmed booking — the guest
    booking flow's one write (invariant 2).

    The seat claim is a single conditional UPDATE:

        UPDATE time_slots SET booked_count = booked_count + :seats
        WHERE id = :id AND booked_count + :seats <= capacity

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
    async with engine().begin() as conn:
        # A slot in the past is not bookable: the UI filters them out,
        # but the API must not rely on that — knowing the id must not
        # let anyone book a session that already started (its
        # manageToken would be born expired). The predicate lives in
        # the chain-select, so a past slot is answered exactly like a
        # missing one: SlotGone → 404 slotGone.
        result = await conn.execute(
            text(
                SLOT_CHAIN_SELECT + "WHERE ts.id = :slot_id AND s.id = :service_id "
                "AND ts.starts_at > now() LIMIT 1"
            ),
            {"slot_id": data.time_slot_id, "service_id": data.service_id},
        )
        chain = scan_slot_chain(result.first())
        if chain is None:
            raise SlotGone()
        slot, service, organizer = chain

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

        result = await conn.execute(
            text(
                "UPDATE time_slots SET booked_count = booked_count + :seats "
                "WHERE id = :slot_id AND booked_count + :seats <= capacity "
                f"RETURNING {SLOT_COLUMNS}"
            ),
            {"seats": data.seats, "slot_id": data.time_slot_id},
        )
        claimed_row = result.first()
        if claimed_row is None:
            # No row claimed → sold out. seats_left is computed from the
            # chain-select snapshot (tx start) — under READ COMMITTED a
            # concurrent booking committed in between can make it stale
            # by a seat or two. Exact TS parity (it read the same
            # snapshot), and the number is UX copy, not an invariant.
            raise SoldOut(domain.seats_left(slot.capacity, slot.booked_count))
        claimed = scan_slot(claimed_row)
        if claimed is None:
            # Unreachable by the decode/guard contract; a real None
            # here is a bug, and python -O must not strip the check.
            raise RuntimeError("claimed is None after its error guard")
        # manageToken expiry: the token is usable until the slot starts
        # plus a grace period — a past event's booking does not need
        # cancel access.
        expires_at = claimed.starts_at + MANAGE_TOKEN_GRACE_PERIOD
        token = new_manage_token()
        try:
            result = await conn.execute(
                text(
                    f"""
                    INSERT INTO bookings (id, time_slot_id, status, seats, guest_name, guest_messenger, guest_messenger_id,
                        guest_messenger_login, guest_locale, manage_token, manage_token_hash, selected_options, manage_token_expires_at)
                    VALUES (:id, :slot_id, 'confirmed', :seats, :guest_name, :messenger, :messenger_id,
                        :messenger_login, :guest_locale, :token, :token_hash, :selected_options, :expires_at)
                    RETURNING {BOOKING_COLUMNS}
                    """
                ),
                {
                    "id": new_id(),
                    "slot_id": claimed.id,
                    "seats": data.seats,
                    "guest_name": data.guest_name,
                    "messenger": data.guest.messenger,
                    "messenger_id": data.guest.messenger_id,
                    "messenger_login": data.guest.messenger_login,
                    "guest_locale": data.guest_locale,
                    "token": token,
                    "token_hash": hash_manage_token(token),
                    "selected_options": selected,
                    "expires_at": expires_at,
                },
            )
        except Exception as err:
            # Duplicate booking — the transaction rolls back, releasing
            # the claimed seat (partial unique index, invariant 4).
            if unique_violation(err):
                raise DuplicateBooking() from err
            raise
        created = scan_booking(result.first())
        if created is None:
            raise SlotGone()

        # Transactional outbox: write one outbox row per recipient in
        # the same transaction, so a crash between commit and the inline
        # publish does not lose the notification — the sweeper
        # re-publishes pending rows. The rows travel back to the caller,
        # which owns the inline delivery and the `sent` marking.
        outbox: list[OutboxRow] = []
        for recipient in ("organizer", "guest"):
            row = await enqueue_outbox(
                conn,
                QUEUE_BOOKING_CREATED,
                lambda outbox_id, r=recipient: {  # type: ignore[misc]
                    "bookingId": created.id,
                    "recipient": r,
                    "outboxId": outbox_id,
                },
                data.trace_id,
            )
            outbox.append(row)

    guest = to_guest_booking(created, claimed, service, organizer)
    return guest, outbox


async def cancel_guest_booking_by_token(
    token: str, trace_id: str
) -> tuple[gen.GuestBooking, list[OutboxRow]] | None:
    """Cancel by manageToken and release the seats (ADR-002). Status
    flip and bookedCount decrement happen in one transaction — invariant
    1: the counter equals the seats held by confirmed bookings. The
    status='confirmed' predicate makes this idempotent under a
    double-tap: the second call updates no row and is reported as
    already cancelled instead of decrementing twice.

    Returns None for an unknown token (caller answers 404 without
    confirming whether the token exists)."""
    async with engine().begin() as conn:
        # Credential check goes through the hash: the raw token column
        # is not a lookup key anymore.
        result = await conn.execute(
            text(BOOKING_CHAIN_SELECT + "WHERE b.manage_token_hash = :token_hash LIMIT 1"),
            {"token_hash": hash_manage_token(token)},
        )
        chain = scan_booking_chain(result.first())
        if chain is None:
            return None
        b, slot, service, organizer = chain

        refuse_demo_write(organizer.id)

        # manageToken expiry: a token past its expiry is answered like an
        # unknown one (None → 404) so the endpoint cannot be used to
        # test whether a token exists. None = non-expiring (legacy rows
        # created before the column was added).
        if b.manage_token_expires_at is not None and datetime.now(UTC) > b.manage_token_expires_at:
            raise BookingNotFound()

        result = await conn.execute(
            text(
                f"UPDATE bookings SET status = 'cancelled' "
                f"WHERE id = :booking_id AND status = 'confirmed' "
                f"RETURNING {BOOKING_COLUMNS}"
            ),
            {"booking_id": b.id},
        )
        cancelled = scan_booking(result.first())
        if cancelled is None:
            raise AlreadyCancelled()

        result = await conn.execute(
            text(
                "UPDATE time_slots SET booked_count = greatest(0, booked_count - :seats) "
                "WHERE id = :slot_id "
                "RETURNING id, service_id, starts_at, duration_minutes, capacity, booked_count, price, created_at"
            ),
            {"seats": cancelled.seats, "slot_id": cancelled.time_slot_id},
        )
        released = scan_slot(result.first())
        if released is None:
            released = slot  # released can't vanish while the booking points at it

        # Transactional outbox: the organizer is notified of the guest's
        # cancellation. One row — the counterparty only (ADR-012). The
        # row travels back to the caller for the inline publish + `sent`
        # marking.
        outbox_row = await enqueue_outbox(
            conn,
            QUEUE_BOOKING_CANCELLED,
            lambda outbox_id: {
                "bookingId": cancelled.id,
                "cancelledBy": "guest",
                "outboxId": outbox_id,
            },
            trace_id,
        )

    guest = to_guest_booking(cancelled, released, service, organizer)
    return guest, [outbox_row]


async def cancel_owned_booking(
    organizer_id: str, booking_id: str, trace_id: str
) -> tuple[gen.BookingRecord, list[OutboxRow]] | None:
    """The cabinet counterpart of cancel_guest_booking_by_token: same
    state transition and seat release, reached by a different
    credential. The organizer proves ownership by owning the service the
    booking hangs off, so the id is scoped through the owned-services
    chain. Returns the organizer's DTO, which drops manageToken: the
    cabinet must never receive it, even as a side effect."""
    refuse_demo_write(organizer_id)

    async with engine().begin() as conn:
        # Unknown id and a booking on someone else's service are
        # answered identically, so the endpoint cannot probe for foreign
        # ids.
        result = await conn.execute(
            text(
                f"SELECT {BOOKING_COLUMNS} "
                "FROM bookings "
                "WHERE id = :booking_id "
                "AND time_slot_id IN ("
                "  SELECT ts.id FROM time_slots ts "
                "  INNER JOIN services s ON ts.service_id = s.id "
                "  WHERE s.organizer_id = :org_id"
                ") LIMIT 1"
            ),
            {"booking_id": booking_id, "org_id": organizer_id},
        )
        target = scan_booking(result.first())
        if target is None:
            return None

        result = await conn.execute(
            text(
                f"UPDATE bookings SET status = 'cancelled' "
                f"WHERE id = :booking_id AND status = 'confirmed' "
                f"RETURNING {BOOKING_COLUMNS}"
            ),
            {"booking_id": target.id},
        )
        cancelled = scan_booking(result.first())
        if cancelled is None:
            raise AlreadyCancelled()

        await conn.execute(
            text(
                "UPDATE time_slots SET booked_count = greatest(0, booked_count - :seats) "
                "WHERE id = :slot_id"
            ),
            {"seats": cancelled.seats, "slot_id": cancelled.time_slot_id},
        )

        # Transactional outbox: the guest is notified of the organizer's
        # cancellation. One row — the counterparty only (ADR-012). The
        # row travels back to the caller for the inline publish + `sent`
        # marking.
        outbox_row = await enqueue_outbox(
            conn,
            QUEUE_BOOKING_CANCELLED,
            lambda outbox_id: {
                "bookingId": cancelled.id,
                "cancelledBy": "organizer",
                "outboxId": outbox_id,
            },
            trace_id,
        )

    record = to_booking_record(cancelled)
    return record, [outbox_row]
