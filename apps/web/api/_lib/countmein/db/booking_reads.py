"""Booking reads (guest-facing; the cabinet reads live in the Next.js
server layer — this package owns the write side, ADR-013)."""

from __future__ import annotations

from ..contracts import models_gen as gen
from ..repositories import booking_repo
from .client import sessionmaker
from .rows import (
    BookingRow,
    OrganizerRow,
    ServiceRow,
    TimeSlotRow,
    from_model_booking,
    from_model_organizer,
    from_model_service,
    from_model_slot,
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
    async with sessionmaker()() as session:
        chains = await booking_repo.list_guest_bookings(session, messenger, messenger_id)
        return [
            to_guest_booking(
                from_model_booking(b),
                from_model_slot(slot),
                from_model_service(service),
                from_model_organizer(organizer),
            )
            for b, slot, service, organizer in chains
        ]


async def get_booking_chain(
    booking_id: str,
) -> tuple[BookingRow, TimeSlotRow, ServiceRow, OrganizerRow] | None:
    """The fresh chain a notification job refetches at send time (jobs
    carry ids only). Raw rows, not DTOs: a notification needs the
    timezone, chat id, manageToken and display overrides."""
    async with sessionmaker()() as session:
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
