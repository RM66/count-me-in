"""Detached domain snapshots (Row dataclasses) and the ORM→Row mapping.

This module is deliberately free of wire concerns: services return Rows,
routes project Rows to the generated DTOs via db/serializers.py. A Row
carries everything a *server-side* consumer needs — including fields no
wire contract may expose (guest_messenger_id, manage_token_hash,
internal timestamps), which is why jobs consume the same Rows the
services return.

Ownership is transitive: there is no organizerId on bookings — a
booking belongs to a slot, the slot to a service, the service to an
organizer. Every read scopes through the parent chain, which is why the
shared shape is the 4-part BookingChain below.

Every live read maps ORM attributes via from_model_* — a reordered
column can never silently swap fields.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any

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


@dataclass
class OutboxRow:
    """One pending, sent or failed notification job (transactional
    outbox, ADR-012)."""

    id: str
    queue: str
    trace_id: str
    status: str
    attempts: int
    created_at: datetime | None = None
    sent_at: datetime | None = None
    # Defaulted: enqueue_outbox_tx builds the payload from the row id
    # and assigns it right after construction.
    payload: str = ""


# The booking's full ownership chain as detached Rows — booking, slot,
# service, organizer. Reads that need the wire answer serialize it via
# db/serializers; notification jobs need exactly this (chat id, manage
# token, timezone — none of which a wire DTO carries).
BookingChain = tuple[BookingRow, TimeSlotRow, ServiceRow, OrganizerRow]


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
