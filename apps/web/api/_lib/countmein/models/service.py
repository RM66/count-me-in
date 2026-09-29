"""Service model — mirrors the `services` table from 0001 baseline."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db.shared import new_service_id
from .base import Base, OptionsSelectMode, enum_values

if TYPE_CHECKING:
    from .organizer import Organizer
    from .time_slot import TimeSlot


class Service(Base):
    """Bookable offering. `id` is a short URL-friendly text id (nanoid)."""

    __tablename__ = "services"

    # default=new_service_id: Python-side nanoid (Drizzle's $defaultFn
    # ran JS-side, so the column has no DB default) — repositories can
    # build Service(...) without an explicit id. ORM-side only,
    # invisible to Alembic DDL comparison.
    id: Mapped[str] = mapped_column(sa.Text, primary_key=True, default=new_service_id)
    organizer_id: Mapped[str] = mapped_column(
        postgresql.UUID(as_uuid=False),
        sa.ForeignKey(
            "organizers.id",
            name="services_organizer_id_organizers_id_fk",
            ondelete="CASCADE",
        ),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(sa.Text, nullable=False)
    description: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    photo_url: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    location: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    contact: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    default_price: Mapped[str] = mapped_column(sa.Text, nullable=False)
    default_capacity: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    default_duration_minutes: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    max_seats_per_booking: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, server_default=sa.text("1")
    )
    options: Mapped[list[str] | None] = mapped_column(postgresql.ARRAY(sa.Text), nullable=True)
    options_select_mode: Mapped[OptionsSelectMode | None] = mapped_column(
        sa.Enum(
            OptionsSelectMode,
            values_callable=enum_values,
            name="options_select_mode",
            create_type=False,
            native_enum=True,
        ),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )

    organizer: Mapped[Organizer] = relationship(
        "Organizer", back_populates="services", lazy="raise"
    )
    # passive_deletes: the DB owns the cascade (ON DELETE CASCADE) —
    # same rationale as Organizer.services above.
    time_slots: Mapped[list[TimeSlot]] = relationship(
        "TimeSlot", back_populates="service", lazy="raise", passive_deletes=True
    )

    __table_args__ = (
        sa.CheckConstraint("default_capacity > 0", name="services_default_capacity_check"),
        sa.CheckConstraint("default_duration_minutes > 0", name="services_default_duration_check"),
        sa.CheckConstraint(
            "max_seats_per_booking >= 1", name="services_max_seats_per_booking_check"
        ),
        sa.CheckConstraint("char_length(title) <= 100", name="services_title_length_check"),
        sa.CheckConstraint(
            "char_length(description) <= 2000", name="services_description_length_check"
        ),
        sa.CheckConstraint(
            "char_length(default_price) <= 50", name="services_default_price_length_check"
        ),
        sa.CheckConstraint("char_length(location) <= 300", name="services_location_length_check"),
        sa.CheckConstraint("char_length(contact) <= 300", name="services_contact_length_check"),
        sa.CheckConstraint(
            "(options IS NULL OR array_length(options, 1) IS NULL) "
            "OR options_select_mode IS NOT NULL",
            name="services_options_select_mode_check",
        ),
        sa.Index("services_organizer_id_idx", "organizer_id"),
    )
