"""The ORM → Row mappers are the live mapping path: every field the
retired positional scans carried must arrive identically through
attribute addressing — no column-order coupling. The raw-SQL scan_*
shims and their *_COLUMNS / *_CHAIN_SELECT projections were removed
with the repository migration; this module now pins the mapper
contract only."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from countmein.db.rows import (
    from_model_booking,
    from_model_organizer,
    from_model_service,
    from_model_slot,
)
from countmein.models.booking import Booking
from countmein.models.organizer import Organizer
from countmein.models.service import Service
from countmein.models.time_slot import TimeSlot


def _model_organizer() -> Organizer:
    return Organizer(
        id=uuid.uuid4(),
        slug="slug",
        name="name",
        messenger="telegram",
        messenger_id="mid",
        timezone="timezone",
        language="en",
        description="desc",
        photo_url="photo",
        location="loc",
        contact="contact",
        created_at=datetime.now(UTC),
    )


def _model_service(organizer_id: object) -> Service:
    return Service(
        id=uuid.uuid4(),
        organizer_id=organizer_id,  # type: ignore[arg-type]
        title="title",
        description="desc",
        photo_url="photo",
        location="loc",
        contact="contact",
        default_price="10",
        default_capacity=8,
        default_duration_minutes=60,
        max_seats_per_booking=4,
        options=["options"],
        options_select_mode="single",
        created_at=datetime.now(UTC),
    )


def test_from_model_mappers_cover_every_row_field():
    """Every Row field the retired positional scans carried must arrive
    identically through attribute addressing — field-level contract for
    the repository migration, no column-order coupling."""
    organizer = from_model_organizer(_model_organizer())
    assert organizer.slug == "slug"
    assert organizer.messenger == "telegram"
    assert organizer.messenger_id == "mid"
    assert organizer.timezone == "timezone"
    assert organizer.language == "en"
    assert organizer.description == "desc"
    assert organizer.photo_url == "photo"
    assert organizer.location == "loc"
    assert organizer.contact == "contact"

    service = from_model_service(_model_service(organizer.id))
    assert service.organizer_id == organizer.id
    assert service.title == "title"
    assert service.default_price == "10"
    assert service.default_capacity == 8
    assert service.default_duration_minutes == 60
    assert service.max_seats_per_booking == 4
    assert service.options == ["options"]
    assert service.options_select_mode == "single"

    slot_model = TimeSlot(
        id=uuid.uuid4(),
        service_id=uuid.uuid4(),
        starts_at=datetime.now(UTC),
        duration_minutes=60,
        capacity=10,
        booked_count=3,
        price="10",
        created_at=datetime.now(UTC),
    )
    slot = from_model_slot(slot_model)
    assert slot.service_id == str(slot_model.service_id)
    assert slot.capacity == 10
    assert slot.booked_count == 3
    assert slot.price == "10"

    booking_model = Booking(
        id=uuid.uuid4(),
        time_slot_id=uuid.uuid4(),
        status="confirmed",
        seats=2,
        guest_name="guest",
        guest_messenger="telegram",
        guest_messenger_id="mid",
        guest_messenger_login="login",
        guest_locale="en",
        manage_token="token",
        manage_token_hash="hash",
        selected_options=["selected_options"],
        created_at=datetime.now(UTC),
        manage_token_expires_at=datetime.now(UTC),
    )
    booking = from_model_booking(booking_model)
    assert booking.status == "confirmed"
    assert booking.guest_messenger == "telegram"
    assert booking.guest_messenger_id == "mid"
    assert booking.manage_token_hash == "hash"
    assert booking.selected_options == ["selected_options"]
