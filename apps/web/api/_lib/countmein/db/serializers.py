"""Model → generated-DTO serialization — the wire half of the boundary.

Repositories return ORM models (expire_on_commit=False + lazy="raise"
make them detached snapshots); routes project them to records here.
The split keeps services free of wire types.

Two audiences, two DTOs: BookingRecord is the organizer's view and drops
manageToken; GuestBooking is the guest's own booking and keeps it,
because that token is their link to the management page.
"""

from __future__ import annotations

from datetime import datetime

from ..contracts import domain
from ..contracts import models_gen as gen
from ..models.booking import Booking
from ..models.organizer import Organizer
from ..models.service import Service
from ..models.time_slot import TimeSlot
from ..repositories.booking_repo import BookingChain

# model_construct (not model_validate) in every mapper: the generated
# UUID fields carry a pattern constraint pydantic-core cannot apply
# (TypeError on every construct), and DB rows are already canonical.


def to_time_slot_record(s: TimeSlot, *, has_bookings: bool | None = None) -> gen.TimeSlotRecord:
    return gen.TimeSlotRecord.model_construct(
        id=s.id,
        serviceId=s.service_id,
        startsAt=domain.iso_date(s.starts_at),
        durationMinutes=s.duration_minutes,
        capacity=s.capacity,
        bookedCount=s.booked_count,
        # None = "not computed" — only the cabinet slot list resolves it,
        # since it backs the delete affordance; cancelled bookings do not
        # count into booked_count but still block deletion.
        hasBookings=has_bookings,
        price=s.price,
        createdAt=domain.iso_date(s.created_at),
    )


def to_service_record(s: Service) -> gen.ServiceRecord:
    return gen.ServiceRecord.model_construct(
        id=s.id,
        organizerId=s.organizer_id,
        title=s.title,
        description=s.description,
        photoUrl=s.photo_url,
        location=s.location,
        contact=s.contact,
        defaultPrice=s.default_price,
        defaultCapacity=s.default_capacity,
        defaultDurationMinutes=s.default_duration_minutes,
        maxSeatsPerBooking=s.max_seats_per_booking,
        options=list(s.options) if s.options is not None else None,
        optionsSelectMode=(
            str(s.options_select_mode) if s.options_select_mode is not None else None
        ),
        createdAt=domain.iso_date(s.created_at),
    )


def to_public_organizer(o: Organizer) -> gen.PublicOrganizer:
    return gen.PublicOrganizer.model_construct(
        id=o.id,
        slug=o.slug,
        name=o.name,
        timezone=o.timezone,
        description=o.description,
        photoUrl=o.photo_url,
        location=o.location,
        contact=o.contact,
        isDemo=domain.is_demo_organizer_id(o.id),
    )


def to_organizer_profile(o: Organizer, is_demo: bool) -> gen.OrganizerProfile:
    # Language clamped to the supported set — a stale column value must
    # not break rendering.
    language = o.language if domain.is_app_locale(o.language) else domain.DEFAULT_LOCALE
    return gen.OrganizerProfile.model_construct(
        id=o.id,
        slug=o.slug,
        name=o.name,
        messenger=str(o.messenger),
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


def to_booking_record(b: Booking) -> gen.BookingRecord:
    return gen.BookingRecord.model_construct(
        id=b.id,
        timeSlotId=b.time_slot_id,
        status=str(b.status),
        seats=b.seats,
        guestName=b.guest_name,
        guestMessenger=str(b.guest_messenger),
        guestMessengerId=b.guest_messenger_id,
        guestMessengerLogin=b.guest_messenger_login,
        selectedOptions=b.selected_options,
        createdAt=domain.iso_date(b.created_at),
    )


def can_cancel_booking(b: Booking, now: datetime | None = None) -> bool:
    """The guest may still act on this booking: confirmed and
    manageToken unexpired. None expiry = legacy row (ADR-020), stays
    cancellable, matching the cancel write's check. The guest DTO
    carries this as canCancel so the link is offered only while it
    works."""
    return str(b.status) == "confirmed" and not domain.manage_token_expired(
        b.manage_token_expires_at, now
    )


def to_guest_booking(
    b: Booking, slot: TimeSlot, service: Service, organizer: Organizer
) -> gen.GuestBooking:
    return gen.GuestBooking.model_construct(
        id=b.id,
        status=str(b.status),
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
    """The 4-part chain projected to the guest DTO in one call."""
    return to_guest_booking(chain.booking, chain.slot, chain.service, chain.organizer)
