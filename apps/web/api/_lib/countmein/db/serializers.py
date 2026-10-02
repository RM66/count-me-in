"""Row → generated-DTO serialization — the wire half of the boundary.

db/rows.py owns the detached domain snapshots and the ORM→Row mapping;
this module owns the Row→DTO projection the routes layer performs. The
split keeps the services layer (services/) free of wire types: a service
returns Rows, a route serializes them.

Two audiences, two DTOs: BookingRecord is the organizer's view and drops
manageToken; GuestBooking is the guest's own booking and keeps it,
because that token is their link to the management page.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from ..contracts import domain
from ..contracts import models_gen as gen
from .rows import BookingChain, BookingRow, OrganizerRow, ServiceRow, TimeSlotRow


def _uuid(value: Any) -> str:
    """Render a uuid column as its canonical string — the wire form of
    an id. The mappers build records with model_construct (no
    validation), so this is also where the canonical form is fixed."""
    return str(value)


# model_construct (not model_validate) in every mapper below: the
# generated UUID fields carry a pattern constraint pydantic-core cannot
# apply to a UUID schema (TypeError on every construct), and the rows
# come straight from the database — already canonical.


def to_time_slot_record(s: TimeSlotRow) -> gen.TimeSlotRecord:
    return gen.TimeSlotRecord.model_construct(
        id=_uuid(s.id),
        serviceId=s.service_id,
        startsAt=domain.iso_date(s.starts_at),
        durationMinutes=s.duration_minutes,
        capacity=s.capacity,
        bookedCount=s.booked_count,
        price=s.price,
        createdAt=domain.iso_date(s.created_at),
    )


def to_service_record(s: ServiceRow) -> gen.ServiceRecord:
    return gen.ServiceRecord.model_construct(
        id=s.id,
        organizerId=_uuid(s.organizer_id),
        title=s.title,
        description=s.description,
        photoUrl=s.photo_url,
        location=s.location,
        contact=s.contact,
        defaultPrice=s.default_price,
        defaultCapacity=s.default_capacity,
        defaultDurationMinutes=s.default_duration_minutes,
        maxSeatsPerBooking=s.max_seats_per_booking,
        options=s.options,
        optionsSelectMode=s.options_select_mode,
        createdAt=domain.iso_date(s.created_at),
    )


def to_public_organizer(o: OrganizerRow) -> gen.PublicOrganizer:
    return gen.PublicOrganizer.model_construct(
        id=_uuid(o.id),
        slug=o.slug,
        name=o.name,
        timezone=o.timezone,
        description=o.description,
        photoUrl=o.photo_url,
        location=o.location,
        contact=o.contact,
        isDemo=domain.is_demo_organizer_id(o.id),
    )


def to_organizer_profile(o: OrganizerRow, is_demo: bool) -> gen.OrganizerProfile:
    # Language clamped to the supported set (a stale column value must
    # not break rendering).
    language = o.language if domain.is_app_locale(o.language) else domain.DEFAULT_LOCALE
    return gen.OrganizerProfile.model_construct(
        id=_uuid(o.id),
        slug=o.slug,
        name=o.name,
        messenger=o.messenger,
        messengerId=o.messenger_id,
        timezone=o.timezone,
        description=o.description,
        photoUrl=o.photo_url,
        location=o.location,
        contact=o.contact,
        language=language,
        createdAt=domain.iso_date(o.created_at),
        isDemo=is_demo,
    )


def to_booking_record(b: BookingRow) -> gen.BookingRecord:
    return gen.BookingRecord.model_construct(
        id=_uuid(b.id),
        timeSlotId=_uuid(b.time_slot_id),
        status=b.status,
        seats=b.seats,
        guestName=b.guest_name,
        guestMessenger=b.guest_messenger,
        guestMessengerId=b.guest_messenger_id,
        guestMessengerLogin=b.guest_messenger_login,
        selectedOptions=b.selected_options,
        createdAt=domain.iso_date(b.created_at),
    )


def can_cancel_booking(b: BookingRow, now: datetime | None = None) -> bool:
    """The guest may still act on this booking: it is confirmed and its
    manageToken has not expired. None expiry means a legacy row created
    before the column existed (ADR-020) and stays cancellable, matching
    the cancel write's check. The guest DTO carries this as canCancel so
    the management link is only offered while it works."""
    if b.status != "confirmed":
        return False
    if b.manage_token_expires_at is None:
        return True
    if now is None:
        now = datetime.now(UTC)
    return b.manage_token_expires_at > now


def to_guest_booking(
    b: BookingRow, slot: TimeSlotRow, service: ServiceRow, organizer: OrganizerRow
) -> gen.GuestBooking:
    return gen.GuestBooking.model_construct(
        id=_uuid(b.id),
        status=b.status,
        seats=b.seats,
        guestName=b.guest_name,
        selectedOptions=b.selected_options,
        createdAt=domain.iso_date(b.created_at),
        manageToken=b.manage_token,
        canCancel=can_cancel_booking(b),
        slot=to_time_slot_record(slot),
        service=to_service_record(service),
        organizer=to_public_organizer(organizer),
    )


def to_guest_booking_chain(chain: BookingChain) -> gen.GuestBooking:
    """The 4-part chain projected to the guest DTO in one call — the
    common route-side shape for booking answers."""
    booking, slot, service, organizer = chain
    return to_guest_booking(booking, slot, service, organizer)
