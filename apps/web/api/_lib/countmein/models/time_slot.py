"""TimeSlot model — mirrors the `time_slots` table from 0001 baseline."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db.shared import new_id
from .base import Base

if TYPE_CHECKING:
    from .booking import Booking
    from .service import Service


class TimeSlot(Base):
    """Concrete occurrence of a service: start + length."""

    __tablename__ = "time_slots"

    # default=new_id: Python-side uuidv7 (Drizzle's $defaultFn ran
    # JS-side — no DB default). ORM-side only, invisible to Alembic.
    id: Mapped[str] = mapped_column(
        postgresql.UUID(as_uuid=False), primary_key=True, default=new_id
    )
    service_id: Mapped[str] = mapped_column(
        sa.Text,
        sa.ForeignKey(
            "services.id",
            name="time_slots_service_id_services_id_fk",
            ondelete="CASCADE",
        ),
        nullable=False,
    )
    starts_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    duration_minutes: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    capacity: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    booked_count: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, server_default=sa.text("0")
    )
    price: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )

    service: Mapped[Service] = relationship("Service", back_populates="time_slots", lazy="raise")
    # passive_deletes: the FK is ON DELETE RESTRICT — the DB refuses a
    # delete while booking rows exist, so the ORM must not nullify
    # time_slot_id first (lazy="raise" would raise on the load; NOT NULL
    # would fail anyway). Lets RESTRICT surface as a 23503 the delete
    # guards map to 409.
    bookings: Mapped[list[Booking]] = relationship(
        "Booking", back_populates="time_slot", lazy="raise", passive_deletes=True
    )

    __table_args__ = (
        sa.CheckConstraint("duration_minutes > 0", name="time_slots_duration_check"),
        sa.CheckConstraint("capacity >= 1", name="time_slots_capacity_check"),
        sa.CheckConstraint(
            "booked_count >= 0 and booked_count <= capacity",
            name="time_slots_booked_count_check",
        ),
        sa.CheckConstraint("char_length(price) <= 50", name="time_slots_price_length_check"),
        sa.Index("time_slots_service_id_idx", "service_id"),
        sa.Index("time_slots_starts_at_idx", "starts_at"),
        sa.Index("time_slots_service_id_starts_at_idx", "service_id", "starts_at"),
    )
