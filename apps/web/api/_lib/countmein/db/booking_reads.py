"""Booking reads (guest-facing; the cabinet reads live in the Next.js
server layer — this package owns the write side, ADR-013)."""

from __future__ import annotations

from sqlalchemy import text

from ..contracts import models_gen as gen
from .client import engine
from .rows import (
    BOOKING_CHAIN_SELECT,
    BookingRow,
    OrganizerRow,
    ServiceRow,
    TimeSlotRow,
    scan_booking_chain,
    to_guest_booking,
)


async def list_guest_bookings(messenger: str, messenger_id: str) -> list[gen.GuestBooking]:
    """Every booking of one messenger identity, newest first (ADR-002,
    entry path 2). Cancelled bookings are included: a guest looking for
    "my bookings" is often checking whether a cancellation went through.
    Expired manageTokens stay listed too (the DTO marks them
    canCancel=false): dropping the row would silently erase the guest's
    booking history 24h after the slot, and the caller of this endpoint
    *is* the owner of the identity, so the expired token is not a leak."""
    async with engine().connect() as conn:
        result = await conn.execute(
            text(
                BOOKING_CHAIN_SELECT
                + "WHERE b.guest_messenger = :messenger AND b.guest_messenger_id = :messenger_id "
                "ORDER BY b.created_at DESC LIMIT 200"
            ),
            {"messenger": messenger, "messenger_id": messenger_id},
        )
        out: list[gen.GuestBooking] = []
        for row in result:
            chain = scan_booking_chain(row)
            if chain is None:
                continue
            b, slot, service, organizer = chain
            out.append(to_guest_booking(b, slot, service, organizer))
        return out


async def get_booking_chain(
    booking_id: str,
) -> tuple[BookingRow, TimeSlotRow, ServiceRow, OrganizerRow] | None:
    """The fresh chain a notification job refetches at send time (jobs
    carry ids only). Raw rows, not DTOs: a notification needs the
    timezone, chat id, manageToken and display overrides."""
    async with engine().connect() as conn:
        result = await conn.execute(
            text(BOOKING_CHAIN_SELECT + "WHERE b.id = :booking_id LIMIT 1"),
            {"booking_id": booking_id},
        )
        return scan_booking_chain(result.first())
