"""Organizer model — mirrors the `organizers` table from 0001 baseline."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db.shared import new_id
from .base import Base, MessengerKind, enum_values

if TYPE_CHECKING:
    from .service import Service


class Organizer(Base):
    """The Auth.js account itself; `id` is the user subject."""

    __tablename__ = "organizers"

    # default=new_id: Python-side uuidv7 (Drizzle's $defaultFn ran
    # JS-side, so the column has no DB default) — lets repositories
    # build Organizer(...) without passing an explicit id. Pure
    # ORM-side, invisible to Alembic DDL comparison.
    id: Mapped[str] = mapped_column(
        postgresql.UUID(as_uuid=False), primary_key=True, default=new_id
    )
    slug: Mapped[str] = mapped_column(sa.Text, nullable=False)
    name: Mapped[str] = mapped_column(sa.Text, nullable=False)
    messenger: Mapped[MessengerKind] = mapped_column(
        sa.Enum(
            MessengerKind,
            values_callable=enum_values,
            name="messenger_kind",
            create_type=False,
            native_enum=True,
        ),
        nullable=False,
    )
    messenger_id: Mapped[str] = mapped_column(sa.Text, nullable=False)
    timezone: Mapped[str] = mapped_column(sa.Text, nullable=False)
    language: Mapped[str] = mapped_column(sa.Text, nullable=False, server_default=sa.text("'en'"))
    description: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    photo_url: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    location: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    contact: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )

    # passive_deletes: the DB owns the cascade (ON DELETE CASCADE) —
    # the ORM must not SELECT-then-nullify children on session.delete()
    # (with lazy="raise" that load would raise InvalidRequestError, and
    # organizer_id is NOT NULL so the nullify would fail anyway).
    services: Mapped[list[Service]] = relationship(
        "Service", back_populates="organizer", lazy="raise", passive_deletes=True
    )

    __table_args__ = (
        sa.CheckConstraint("char_length(slug) <= 40", name="organizers_slug_length_check"),
        sa.CheckConstraint("char_length(name) <= 100", name="organizers_name_length_check"),
        sa.CheckConstraint(
            "char_length(description) <= 4000", name="organizers_description_length_check"
        ),
        sa.CheckConstraint("char_length(location) <= 300", name="organizers_location_length_check"),
        sa.CheckConstraint("char_length(contact) <= 300", name="organizers_contact_length_check"),
        sa.CheckConstraint("char_length(timezone) <= 64", name="organizers_timezone_length_check"),
        sa.CheckConstraint("char_length(language) <= 8", name="organizers_language_length_check"),
        sa.Index("organizers_slug_key", "slug", unique=True),
        sa.Index("organizers_messenger_id_key", "messenger", "messenger_id", unique=True),
    )
