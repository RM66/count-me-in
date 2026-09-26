"""Row types, chain scans and DTO mapping shared by the entity modules.

Ownership is transitive: there is no organizerId on bookings — a
booking belongs to a slot, the slot to a service, the service to an
organizer. Every read scopes through the parent chain.

Two audiences, two DTOs: BookingRecord is the organizer's view and
drops manageToken; GuestBooking is the guest's own booking and keeps
it, because that token is their link to the management page.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from ..contracts import domain
from ..contracts import models_gen as gen
from .shared import parse_string_array

# array_to_json projections make NULL arrays explicit.
BOOKING_COLUMNS = (
    "id, time_slot_id, status::text, seats, guest_name, guest_messenger::text, "
    "guest_messenger_id, guest_messenger_login, guest_locale, manage_token, "
    "manage_token_hash, array_to_json(selected_options), created_at, manage_token_expires_at"
)
SLOT_COLUMNS = (
    "id, service_id, starts_at, duration_minutes, capacity, booked_count, price, created_at"
)
SERVICE_COLUMNS = (
    "id, organizer_id, title, description, photo_url, location, contact, default_price, "
    "default_capacity, default_duration_minutes, max_seats_per_booking, "
    "array_to_json(options), options_select_mode::text, created_at"
)
ORGANIZER_COLUMNS = (
    "id, slug, name, messenger::text, messenger_id, timezone, language, description, "
    "photo_url, location, contact, created_at"
)

# The TimeSlot → Service → Organizer chain (no bookings): what
# create_guest_booking needs before it has a booking.
SLOT_CHAIN_SELECT = """
SELECT
  ts.id, ts.service_id, ts.starts_at, ts.duration_minutes, ts.capacity, ts.booked_count, ts.price, ts.created_at,
  s.id, s.organizer_id, s.title, s.description, s.photo_url, s.location, s.contact, s.default_price,
  s.default_capacity, s.default_duration_minutes, s.max_seats_per_booking, array_to_json(s.options), s.options_select_mode::text, s.created_at,
  o.id, o.slug, o.name, o.messenger::text, o.messenger_id, o.timezone, o.language, o.description, o.photo_url, o.location, o.contact, o.created_at
FROM time_slots ts
JOIN services s ON ts.service_id = s.id
JOIN organizers o ON s.organizer_id = o.id
"""

# The Booking → TimeSlot → Service → Organizer chain in one statement:
# every guest-facing read needs all four.
BOOKING_CHAIN_SELECT = """
SELECT
  b.id, b.time_slot_id, b.status::text, b.seats, b.guest_name, b.guest_messenger::text, b.guest_messenger_id, b.guest_messenger_login, b.guest_locale, b.manage_token, b.manage_token_hash, array_to_json(b.selected_options), b.created_at, b.manage_token_expires_at,
  ts.id, ts.service_id, ts.starts_at, ts.duration_minutes, ts.capacity, ts.booked_count, ts.price, ts.created_at,
  s.id, s.organizer_id, s.title, s.description, s.photo_url, s.location, s.contact, s.default_price,
  s.default_capacity, s.default_duration_minutes, s.max_seats_per_booking, array_to_json(s.options), s.options_select_mode::text, s.created_at,
  o.id, o.slug, o.name, o.messenger::text, o.messenger_id, o.timezone, o.language, o.description, o.photo_url, o.location, o.contact, o.created_at
FROM bookings b
JOIN time_slots ts ON b.time_slot_id = ts.id
JOIN services s ON ts.service_id = s.id
JOIN organizers o ON s.organizer_id = o.id
"""


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


def _root(value: Any) -> Any:
    while hasattr(value, "root"):
        value = value.root
    return value


def _str(value: Any) -> str:
    """Canonical string for an id column: psycopg hands back UUID
    objects, seed templates hand strings — both must land as the same
    plain str on the row, or every downstream comparison against a
    string constant (the demo guard's DEMO_ORGANIZER_ID check, fixture
    ids in tests) silently misses."""
    return str(_root(value))


def scan_organizer(row: Any) -> OrganizerRow | None:
    if row is None:
        return None
    return OrganizerRow(
        id=_str(row[0]),
        slug=row[1],
        name=row[2],
        messenger=row[3],
        messenger_id=row[4],
        timezone=row[5],
        language=row[6],
        description=row[7],
        photo_url=row[8],
        location=row[9],
        contact=row[10],
        created_at=row[11],
    )


def scan_service(row: Any) -> ServiceRow | None:
    if row is None:
        return None
    return ServiceRow(
        id=_str(row[0]),
        organizer_id=_str(row[1]),
        title=row[2],
        description=row[3],
        photo_url=row[4],
        location=row[5],
        contact=row[6],
        default_price=row[7],
        default_capacity=row[8],
        default_duration_minutes=row[9],
        max_seats_per_booking=row[10],
        options=parse_string_array(row[11]),
        options_select_mode=row[12],
        created_at=row[13],
    )


def scan_slot(row: Any) -> TimeSlotRow | None:
    if row is None:
        return None
    return TimeSlotRow(
        id=_str(row[0]),
        service_id=_str(row[1]),
        starts_at=row[2],
        duration_minutes=row[3],
        capacity=row[4],
        booked_count=row[5],
        price=row[6],
        created_at=row[7],
    )


def scan_booking(row: Any) -> BookingRow | None:
    if row is None:
        return None
    return BookingRow(
        id=_str(row[0]),
        time_slot_id=_str(row[1]),
        status=row[2],
        seats=row[3],
        guest_name=row[4],
        guest_messenger=row[5],
        guest_messenger_id=row[6],
        guest_messenger_login=row[7],
        guest_locale=row[8],
        manage_token=row[9],
        manage_token_hash=row[10],
        selected_options=parse_string_array(row[11]),
        created_at=row[12],
        manage_token_expires_at=row[13],
    )


def scan_slot_chain(row: Any) -> tuple[TimeSlotRow, ServiceRow, OrganizerRow] | None:
    if row is None:
        return None
    slot = TimeSlotRow(
        id=_str(row[0]),
        service_id=_str(row[1]),
        starts_at=row[2],
        duration_minutes=row[3],
        capacity=row[4],
        booked_count=row[5],
        price=row[6],
        created_at=row[7],
    )
    service = ServiceRow(
        id=_str(row[8]),
        organizer_id=_str(row[9]),
        title=row[10],
        description=row[11],
        photo_url=row[12],
        location=row[13],
        contact=row[14],
        default_price=row[15],
        default_capacity=row[16],
        default_duration_minutes=row[17],
        max_seats_per_booking=row[18],
        options=parse_string_array(row[19]),
        options_select_mode=row[20],
        created_at=row[21],
    )
    organizer = OrganizerRow(
        id=_str(row[22]),
        slug=row[23],
        name=row[24],
        messenger=row[25],
        messenger_id=row[26],
        timezone=row[27],
        language=row[28],
        description=row[29],
        photo_url=row[30],
        location=row[31],
        contact=row[32],
        created_at=row[33],
    )
    return slot, service, organizer


def scan_booking_chain(
    row: Any,
) -> tuple[BookingRow, TimeSlotRow, ServiceRow, OrganizerRow] | None:
    if row is None:
        return None
    booking = BookingRow(
        id=_str(row[0]),
        time_slot_id=_str(row[1]),
        status=row[2],
        seats=row[3],
        guest_name=row[4],
        guest_messenger=row[5],
        guest_messenger_id=row[6],
        guest_messenger_login=row[7],
        guest_locale=row[8],
        manage_token=row[9],
        manage_token_hash=row[10],
        selected_options=parse_string_array(row[11]),
        created_at=row[12],
        manage_token_expires_at=row[13],
    )
    slot = TimeSlotRow(
        id=_str(row[14]),
        service_id=_str(row[15]),
        starts_at=row[16],
        duration_minutes=row[17],
        capacity=row[18],
        booked_count=row[19],
        price=row[20],
        created_at=row[21],
    )
    service = ServiceRow(
        id=_str(row[22]),
        organizer_id=_str(row[23]),
        title=row[24],
        description=row[25],
        photo_url=row[26],
        location=row[27],
        contact=row[28],
        default_price=row[29],
        default_capacity=row[30],
        default_duration_minutes=row[31],
        max_seats_per_booking=row[32],
        options=parse_string_array(row[33]),
        options_select_mode=row[34],
        created_at=row[35],
    )
    organizer = OrganizerRow(
        id=_str(row[36]),
        slug=row[37],
        name=row[38],
        messenger=row[39],
        messenger_id=row[40],
        timezone=row[41],
        language=row[42],
        description=row[43],
        photo_url=row[44],
        location=row[45],
        contact=row[46],
        created_at=row[47],
    )
    return booking, slot, service, organizer


# ── DTO mappers ──────────────────────────────────────────────────────────────


def _uuid(value: Any) -> gen.UUIDModel:
    """Wrap a plain uuid string into the generated UUIDModel. The
    generated model carries a pattern constraint that pydantic-core
    cannot apply to a coerced UUID (TypeError on every construct), so
    the wrapper is built without re-validation — the id comes from the
    database and is already canonical. Idempotent for wrapped values."""
    if isinstance(value, gen.UUIDModel):
        return value
    return gen.UUIDModel.model_construct(root=value)


def to_time_slot_record(s: TimeSlotRow) -> gen.TimeSlotRecord:
    return gen.TimeSlotRecord(
        id=_uuid(s.id),
        serviceId=s.service_id,  # type: ignore[arg-type]
        startsAt=domain.iso_date(s.starts_at),
        durationMinutes=s.duration_minutes,  # type: ignore[arg-type]
        capacity=s.capacity,  # type: ignore[arg-type]
        bookedCount=s.booked_count,
        price=s.price,
        createdAt=domain.iso_date(s.created_at),  # type: ignore[arg-type]
    )


def to_service_record(s: ServiceRow) -> gen.ServiceRecord:
    return gen.ServiceRecord(
        id=s.id,  # type: ignore[arg-type]
        organizerId=_uuid(s.organizer_id),
        title=s.title,  # type: ignore[arg-type]
        description=s.description,
        photoUrl=s.photo_url,
        location=s.location,
        contact=s.contact,
        defaultPrice=s.default_price,  # type: ignore[arg-type]
        defaultCapacity=s.default_capacity,  # type: ignore[arg-type]
        defaultDurationMinutes=s.default_duration_minutes,  # type: ignore[arg-type]
        maxSeatsPerBooking=s.max_seats_per_booking,  # type: ignore[arg-type]
        options=s.options,
        optionsSelectMode=s.options_select_mode,  # type: ignore[arg-type]
        createdAt=domain.iso_date(s.created_at),  # type: ignore[arg-type]
    )


def to_public_organizer(o: OrganizerRow) -> gen.PublicOrganizer:
    return gen.PublicOrganizer(
        id=_uuid(o.id),
        slug=o.slug,  # type: ignore[arg-type]
        name=o.name,  # type: ignore[arg-type]
        timezone=o.timezone,  # type: ignore[arg-type]
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
    return gen.OrganizerProfile(
        id=_uuid(o.id),
        slug=o.slug,  # type: ignore[arg-type]
        name=o.name,  # type: ignore[arg-type]
        messenger=o.messenger,  # type: ignore[arg-type]
        messengerId=o.messenger_id,
        timezone=o.timezone,  # type: ignore[arg-type]
        description=o.description,
        photoUrl=o.photo_url,
        location=o.location,
        contact=o.contact,
        language=language,  # type: ignore[arg-type]
        createdAt=domain.iso_date(o.created_at),  # type: ignore[arg-type]
        isDemo=is_demo,
    )


def to_booking_record(b: BookingRow) -> gen.BookingRecord:
    return gen.BookingRecord(
        id=_uuid(b.id),
        timeSlotId=_uuid(b.time_slot_id),
        status=b.status,  # type: ignore[arg-type]
        seats=b.seats,  # type: ignore[arg-type]
        guestName=b.guest_name,  # type: ignore[arg-type]
        guestMessenger=b.guest_messenger,  # type: ignore[arg-type]
        guestMessengerId=b.guest_messenger_id,
        guestMessengerLogin=b.guest_messenger_login,
        selectedOptions=b.selected_options,
        createdAt=domain.iso_date(b.created_at),  # type: ignore[arg-type]
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
    return gen.GuestBooking(
        id=_uuid(b.id),
        status=b.status,  # type: ignore[arg-type]
        seats=b.seats,  # type: ignore[arg-type]
        guestName=b.guest_name,  # type: ignore[arg-type]
        selectedOptions=b.selected_options,
        createdAt=domain.iso_date(b.created_at),  # type: ignore[arg-type]
        manageToken=b.manage_token,  # type: ignore[arg-type]
        canCancel=can_cancel_booking(b),
        slot=to_time_slot_record(slot),
        service=to_service_record(service),
        organizer=to_public_organizer(organizer),
    )
