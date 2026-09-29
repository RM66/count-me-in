"""Booking model — mirrors the `bookings` table from 0001 baseline."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db.shared import new_id
from .base import Base, BookingStatus, MessengerKind, enum_values

if TYPE_CHECKING:
    from .time_slot import TimeSlot


class Booking(Base):
    """Guest reservation on a slot (no visitor Auth.js account)."""

    __tablename__ = "bookings"

    # default=new_id: Python-side uuidv7 (Drizzle's $defaultFn ran
    # JS-side, so the column has no DB default). ORM-side only,
    # invisible to Alembic DDL comparison.
    id: Mapped[str] = mapped_column(
        postgresql.UUID(as_uuid=False), primary_key=True, default=new_id
    )
    time_slot_id: Mapped[str] = mapped_column(
        postgresql.UUID(as_uuid=False),
        sa.ForeignKey(
            "time_slots.id",
            name="bookings_time_slot_id_time_slots_id_fk",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    status: Mapped[BookingStatus] = mapped_column(
        sa.Enum(
            BookingStatus,
            values_callable=enum_values,
            name="booking_status",
            create_type=False,
            native_enum=True,
        ),
        nullable=False,
    )
    seats: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    guest_name: Mapped[str] = mapped_column(sa.Text, nullable=False)
    guest_messenger: Mapped[MessengerKind] = mapped_column(
        sa.Enum(
            MessengerKind,
            values_callable=enum_values,
            name="messenger_kind",
            create_type=False,
            native_enum=True,
        ),
        nullable=False,
    )
    guest_messenger_id: Mapped[str] = mapped_column(sa.Text, nullable=False)
    guest_messenger_login: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    guest_locale: Mapped[str] = mapped_column(
        sa.Text, nullable=False, server_default=sa.text("'en'")
    )
    manage_token: Mapped[str] = mapped_column(sa.Text, nullable=False)
    # SHA-256 hex of manage_token — the lookup key for credential checks.
    manage_token_hash: Mapped[str] = mapped_column(sa.Text, nullable=False)
    selected_options: Mapped[list[str] | None] = mapped_column(
        postgresql.ARRAY(sa.Text), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )
    manage_token_expires_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )

    time_slot: Mapped[TimeSlot] = relationship("TimeSlot", back_populates="bookings", lazy="raise")

    __table_args__ = (
        sa.CheckConstraint("seats >= 1", name="bookings_seats_check"),
        sa.CheckConstraint(
            "char_length(guest_name) <= 100", name="bookings_guest_name_length_check"
        ),
        sa.CheckConstraint(
            "char_length(guest_messenger_id) <= 100",
            name="bookings_guest_messenger_id_length_check",
        ),
        sa.CheckConstraint(
            "char_length(manage_token) <= 128",
            name="bookings_manage_token_length_check",
        ),
        sa.Index("bookings_time_slot_id_idx", "time_slot_id"),
        sa.Index("bookings_time_slot_id_created_at_idx", "time_slot_id", "created_at"),
        sa.Index("bookings_created_at_idx", "created_at"),
        sa.Index("bookings_guest_messenger_idx", "guest_messenger", "guest_messenger_id"),
        sa.Index("bookings_manage_token_key", "manage_token", unique=True),
        sa.Index("bookings_manage_token_hash_key", "manage_token_hash", unique=True),
        sa.Index(
            "bookings_one_active_per_guest_per_slot",
            "time_slot_id",
            "guest_messenger",
            "guest_messenger_id",
            unique=True,
            postgresql_where=sa.text("status = 'confirmed'"),
        ),
    )
