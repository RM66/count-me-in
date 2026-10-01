"""Row types, ORM mapping and DTO mapping shared by the entity modules.

Ownership is transitive: there is no organizerId on bookings — a
booking belongs to a slot, the slot to a service, the service to an
organizer. Every read scopes through the parent chain.

Two audiences, two DTOs: BookingRecord is the organizer's view and
drops manageToken; GuestBooking is the guest's own booking and keeps
it, because that token is their link to the management page.

Every live read maps ORM attributes via from_model_* — the raw-SQL
positional scans (row[i]) were removed with the repository migration,
so a reordered column can never silently swap fields.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any

from ..contracts import domain
from ..contracts import models_gen as gen

if TYPE_CHECKING:
    from ..models.booking import Booking
    from ..models.organizer import Organizer
    from ..models.service import Service
    from ..models.time_slot import TimeSlot


@dataclass
class OrganizerRow:
    id: str
    slug: str
    name: str
    messenger: str
    messenger_id: str
    timezone: str
    language: str
    description: str | None = None
    photo_url: str | None = None
    location: str | None = None
    contact: str | None = None
    created_at: datetime | None = None


@dataclass
class ServiceRow:
    id: str
    organizer_id: str
    title: str
    default_price: str
    default_capacity: int
    default_duration_minutes: int
    max_seats_per_booking: int
    created_at: datetime | None = None
    description: str | None = None
    photo_url: str | None = None
    location: str | None = None
    contact: str | None = None
    options: list[str] | None = None
    options_select_mode: str | None = None


@dataclass
class TimeSlotRow:
    id: str
    service_id: str
    starts_at: datetime
    duration_minutes: int
    capacity: int
    booked_count: int
    created_at: datetime | None = None
    price: str | None = None


@dataclass
class BookingRow:
    id: str
    time_slot_id: str
    status: str
    seats: int
    guest_name: str
    guest_messenger: str
    guest_messenger_id: str
    guest_locale: str
    manage_token: str
    # SHA-256 hex of manage_token — the lookup key for credential checks.
    # The raw token stays on the row only for the flows that re-issue the
    # deep link.
    manage_token_hash: str
    created_at: datetime | None = None
    guest_messenger_login: str | None = None
    selected_options: list[str] | None = None
    manage_token_expires_at: datetime | None = None


def _str(value: Any) -> str:
    """Canonical string for an id column: psycopg hands back UUID
    objects, seed templates hand strings — both must land as the same
    plain str on the row, or every downstream comparison against a
    string constant (the demo guard's DEMO_ORGANIZER_ID check, fixture
    ids in tests) silently misses."""
    return str(value)


def _enum_str(value: Any) -> str:
    """Render a NOT NULL ORM enum attribute as its lowercase Postgres
    value. psycopg hands back the raw 'telegram' string; the ORM hands
    back the StrEnum member (also 'telegram' via str(), but explicit is
    better than relying on StrEnum.__str__ staying value-shaped)."""
    if isinstance(value, enum.Enum):
        return str(value.value)
    return str(value)


def _enum_text(value: Any) -> str | None:
    """Nullable-column variant: None passes through (options_select_mode
    is unset on old rows)."""
    if value is None:
        return None
    return _enum_str(value)


def from_model_organizer(o: Organizer) -> OrganizerRow:
    """Map an Organizer ORM instance to its Row via attributes."""
    return OrganizerRow(
        id=_str(o.id),
        slug=o.slug,
        name=o.name,
        messenger=_enum_str(o.messenger),
        messenger_id=o.messenger_id,
        timezone=o.timezone,
        language=o.language,
        description=o.description,
        photo_url=o.photo_url,
        location=o.location,
        contact=o.contact,
        created_at=o.created_at,
    )


def from_model_service(s: Service) -> ServiceRow:
    return ServiceRow(
        id=_str(s.id),
        organizer_id=_str(s.organizer_id),
        title=s.title,
        description=s.description,
        photo_url=s.photo_url,
        location=s.location,
        contact=s.contact,
        default_price=s.default_price,
        default_capacity=s.default_capacity,
        default_duration_minutes=s.default_duration_minutes,
        max_seats_per_booking=s.max_seats_per_booking,
        options=list(s.options) if s.options is not None else None,
        options_select_mode=_enum_text(s.options_select_mode)
        if s.options_select_mode is not None
        else None,
        created_at=s.created_at,
    )


def from_model_slot(s: TimeSlot) -> TimeSlotRow:
    return TimeSlotRow(
        id=_str(s.id),
        service_id=_str(s.service_id),
        starts_at=s.starts_at,
        duration_minutes=s.duration_minutes,
        capacity=s.capacity,
        booked_count=s.booked_count,
        price=s.price,
        created_at=s.created_at,
    )


def from_model_booking(b: Booking) -> BookingRow:
    return BookingRow(
        id=_str(b.id),
        time_slot_id=_str(b.time_slot_id),
        status=_enum_str(b.status),
        seats=b.seats,
        guest_name=b.guest_name,
        guest_messenger=_enum_str(b.guest_messenger),
        guest_messenger_id=b.guest_messenger_id,
        guest_messenger_login=b.guest_messenger_login,
        guest_locale=b.guest_locale,
        manage_token=b.manage_token,
        manage_token_hash=b.manage_token_hash,
        selected_options=list(b.selected_options) if b.selected_options is not None else None,
        created_at=b.created_at,
        manage_token_expires_at=b.manage_token_expires_at,
    )


# ── DTO mappers ──────────────────────────────────────────────────────────────


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
    from datetime import UTC
    from datetime import datetime as dt

    if b.status != "confirmed":
        return False
    if b.manage_token_expires_at is None:
        return True
    if now is None:
        now = dt.now(UTC)
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
