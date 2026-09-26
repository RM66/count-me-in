"""SQLAlchemy Core Table declarations, hand-written from the Drizzle
schema (packages/db remains the schema owner — these mirror it for
query building; tests_py/db/test_tables_match_schema.py reflects the
migrated DB and asserts every declared column matches).
"""

from __future__ import annotations

from sqlalchemy import (
    CheckConstraint,
    Column,
    Index,
    Integer,
    MetaData,
    Table,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, ENUM, TIMESTAMP, UUID
from sqlalchemy.sql import func

meta = MetaData()

options_select_mode_enum = ENUM(
    "single", "multi", name="options_select_mode", metadata=meta, create_type=False
)
booking_status_enum = ENUM(
    "confirmed", "cancelled", name="booking_status", metadata=meta, create_type=False
)
messenger_kind_enum = ENUM("telegram", name="messenger_kind", metadata=meta, create_type=False)
outbox_status_enum = ENUM(
    "pending", "sent", "failed", "skipped", name="outbox_status", metadata=meta, create_type=False
)

organizers = Table(
    "organizers",
    meta,
    # The organizer is the Auth.js account itself; id is the user subject.
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("slug", Text, nullable=False),
    Column("name", Text, nullable=False),
    Column("messenger", messenger_kind_enum, nullable=False),
    Column("messenger_id", Text, nullable=False),
    Column("timezone", Text, nullable=False),
    # Notification language (ADR-011): the locale the worker renders
    # this organizer's messages in.
    Column("language", Text, nullable=False, server_default=text("'en'")),
    Column("description", Text),
    Column("photo_url", Text),
    Column("location", Text),
    Column("contact", Text),
    Column(
        "created_at",
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    ),
    UniqueConstraint("slug", name="organizers_slug_key"),
    UniqueConstraint("messenger", "messenger_id", name="organizers_messenger_id_key"),
    CheckConstraint("char_length(slug) <= 40", name="organizers_slug_length_check"),
    CheckConstraint("char_length(name) <= 100", name="organizers_name_length_check"),
    CheckConstraint("char_length(description) <= 4000", name="organizers_description_length_check"),
    CheckConstraint("char_length(location) <= 300", name="organizers_location_length_check"),
    CheckConstraint("char_length(contact) <= 300", name="organizers_contact_length_check"),
    CheckConstraint("char_length(timezone) <= 64", name="organizers_timezone_length_check"),
    CheckConstraint("char_length(language) <= 8", name="organizers_language_length_check"),
)

services = Table(
    "services",
    meta,
    # Bookable offering. id is a short, URL-friendly text id (public URLs).
    Column("id", Text, primary_key=True),
    Column(
        "organizer_id",
        UUID(as_uuid=False),
        nullable=False,
    ),
    Column("title", Text, nullable=False),
    Column("description", Text),
    Column("photo_url", Text),
    Column("location", Text),
    Column("contact", Text),
    Column("default_price", Text, nullable=False),
    Column("default_capacity", Integer, nullable=False),
    Column("default_duration_minutes", Integer, nullable=False),
    # Cap on how many seats a single guest may claim in one booking
    # (party size). The effective ceiling at booking time is
    # min(maxSeatsPerBooking, seatsLeft).
    Column("max_seats_per_booking", Integer, nullable=False, server_default=text("1")),
    Column("options", ARRAY(Text)),
    Column("options_select_mode", options_select_mode_enum),
    Column(
        "created_at",
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    ),
    Index("services_organizer_id_idx", "organizer_id"),
    CheckConstraint("default_capacity > 0", name="services_default_capacity_check"),
    CheckConstraint("default_duration_minutes > 0", name="services_default_duration_check"),
    CheckConstraint("max_seats_per_booking >= 1", name="services_max_seats_per_booking_check"),
    CheckConstraint("char_length(title) <= 100", name="services_title_length_check"),
    CheckConstraint("char_length(description) <= 2000", name="services_description_length_check"),
    CheckConstraint("char_length(default_price) <= 50", name="services_default_price_length_check"),
    CheckConstraint("char_length(location) <= 300", name="services_location_length_check"),
    CheckConstraint("char_length(contact) <= 300", name="services_contact_length_check"),
    # options non-empty implies options_select_mode is set — the pair
    # is patched together on the wire (RFC 7386 merge-patch) and in the DB.
    CheckConstraint(
        "(options IS NULL OR array_length(options, 1) IS NULL) OR options_select_mode IS NOT NULL",
        name="services_options_select_mode_check",
    ),
)

time_slots = Table(
    "time_slots",
    meta,
    # Concrete occurrence of a service: start + length; endsAt computed
    # in application code.
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("service_id", Text, nullable=False),
    Column("starts_at", TIMESTAMP(timezone=True), nullable=False),
    Column("duration_minutes", Integer, nullable=False),
    Column("capacity", Integer, nullable=False),
    Column("booked_count", Integer, nullable=False, server_default=text("0")),
    Column("price", Text),
    Column(
        "created_at",
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    ),
    Index("time_slots_service_id_idx", "service_id"),
    Index("time_slots_starts_at_idx", "starts_at"),
    Index("time_slots_service_id_starts_at_idx", "service_id", "starts_at"),
    CheckConstraint("duration_minutes > 0", name="time_slots_duration_check"),
    CheckConstraint("capacity >= 1", name="time_slots_capacity_check"),
    CheckConstraint(
        "booked_count >= 0 and booked_count <= capacity",
        name="time_slots_booked_count_check",
    ),
    CheckConstraint("char_length(price) <= 50", name="time_slots_price_length_check"),
)

bookings = Table(
    "bookings",
    meta,
    # Guest reservation on a slot (no visitor Auth.js account).
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("time_slot_id", UUID(as_uuid=False), nullable=False),
    Column("status", booking_status_enum, nullable=False),
    Column("seats", Integer, nullable=False),
    Column("guest_name", Text, nullable=False),
    Column("guest_messenger", messenger_kind_enum, nullable=False),
    Column("guest_messenger_id", Text, nullable=False),
    Column("guest_messenger_login", Text),
    # The locale the guest's confirmation/cancellation messages are
    # rendered in (ADR-011).
    Column("guest_locale", Text, nullable=False, server_default=text("'en'")),
    Column("manage_token", Text, nullable=False),
    # SHA-256(token) hex — the lookup key for cancel and the guest
    # management page. The raw column stays for the flows that must
    # re-issue the link (ADR-020).
    Column("manage_token_hash", Text, nullable=False),
    Column("selected_options", ARRAY(Text)),
    Column(
        "created_at",
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    ),
    # When the manageToken stops being usable for cancellation. Set to
    # the slot's start time plus a grace period — a past event's booking
    # does not need cancel access. Null for rows created before this
    # column existed (treated as non-expiring).
    Column("manage_token_expires_at", TIMESTAMP(timezone=True)),
    Index("bookings_time_slot_id_idx", "time_slot_id"),
    Index("bookings_time_slot_id_created_at_idx", "time_slot_id", "created_at"),
    Index("bookings_created_at_idx", "created_at"),
    Index("bookings_guest_messenger_idx", "guest_messenger", "guest_messenger_id"),
    UniqueConstraint("manage_token", name="bookings_manage_token_key"),
    UniqueConstraint("manage_token_hash", name="bookings_manage_token_hash_key"),
    # One active booking per guest per slot. A partial unique index so a
    # guest cannot hold two confirmed bookings on the same slot at once
    # — cancelled bookings are excluded, so a guest who cancels and
    # re-books is not blocked. Enforced in the database so two
    # concurrent attempts cannot both succeed; the second INSERT raises
    # a 23505 that create_guest_booking maps to DuplicateBookingError.
    Index(
        "bookings_one_active_per_guest_per_slot",
        "time_slot_id",
        "guest_messenger",
        "guest_messenger_id",
        unique=True,
        postgresql_where=text("status = 'confirmed'"),
    ),
    CheckConstraint("seats >= 1", name="bookings_seats_check"),
    CheckConstraint("char_length(guest_name) <= 100", name="bookings_guest_name_length_check"),
    CheckConstraint(
        "char_length(guest_messenger_id) <= 100",
        name="bookings_guest_messenger_id_length_check",
    ),
    CheckConstraint("char_length(manage_token) <= 128", name="bookings_manage_token_length_check"),
)

notification_outbox = Table(
    "notification_outbox",
    meta,
    # Transactional outbox for notification publishing. A row is
    # written in the same transaction as the booking commit, carrying
    # the queue name and the job payload (ids only). The inline publish
    # runs after commit; if it fails, the sweeper job reads pending
    # rows past a grace period and re-publishes them, marking them sent
    # on success — a committed booking always eventually notifies.
    Column("id", UUID(as_uuid=False), primary_key=True),
    # QStash queue name (booking.created, booking.cancelled).
    Column("queue", Text, nullable=False),
    # JSON payload — the job body (ids only, no secrets).
    Column("payload", Text, nullable=False),
    Column("status", outbox_status_enum, nullable=False, server_default=text("'pending'")),
    # attempts counts publish tries so the sweeper can give up after a
    # bounded number of failures (logged, not retried forever).
    Column("attempts", Integer, nullable=False, server_default=text("0")),
    # Trace id stamped on the QStash message; forwarded on sweeper republish.
    Column("trace_id", Text),
    Column(
        "created_at",
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    ),
    Column("sent_at", TIMESTAMP(timezone=True)),
    Index("notification_outbox_status_idx", "status", "created_at"),
    CheckConstraint("attempts >= 0", name="notification_outbox_attempts_check"),
)
