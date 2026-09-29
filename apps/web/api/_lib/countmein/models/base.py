"""SQLAlchemy 2.0 declarative base and shared Postgres enums.

The four custom Postgres types are owned by migration 0001 (created via
op.execute CREATE TYPE). Models reference them with create_type=False so
autogenerate never tries to re-create them — the metadata only mirrors
the live schema for `alembic check` / future autogenerate runs.
"""

from __future__ import annotations

import enum

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base for all CountMeIn tables.

    No naming convention: every constraint and index carries its
    explicit Drizzle-era name so `alembic check` stays empty against
    the 0001 baseline.
    """


def enum_values(e: type[enum.Enum]) -> list[str]:
    """Persist enum *values* ('telegram'), not member names ('TELEGRAM').

    SQLAlchemy's Enum defaults to member names; the live Postgres enums
    hold lowercase values, so every Enum column passes this callable.
    """
    return [str(m.value) for m in e]


class MessengerKind(enum.StrEnum):
    """messenger_kind Postgres enum — a single variant in MVP (ADR-008)."""

    TELEGRAM = "telegram"


class OptionsSelectMode(enum.StrEnum):
    """options_select_mode Postgres enum (service options pair)."""

    SINGLE = "single"
    MULTI = "multi"


class BookingStatus(enum.StrEnum):
    """booking_status Postgres enum — only confirmed | cancelled."""

    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"


class OutboxStatus(enum.StrEnum):
    """outbox_status Postgres enum (ADR-012 transactional outbox)."""

    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
    SKIPPED = "skipped"
