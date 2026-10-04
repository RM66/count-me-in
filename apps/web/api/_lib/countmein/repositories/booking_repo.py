"""Booking repository: typed SQLAlchemy 2.0 queries over Booking.

The seat counters move only through conditional UPDATEs — the atomic
reserve, the cancel-release, the organizer-cancel release. No
read-check-write anywhere here: the predicate is the guard.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, NamedTuple

from sqlalchemy import func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute
from sqlalchemy.sql import Select
from sqlalchemy.sql.elements import ColumnElement

from ..models.base import BookingStatus, MessengerKind
from ..models.booking import Booking
from ..models.organizer import Organizer
from ..models.service import Service
from ..models.time_slot import TimeSlot


class BookingChain(NamedTuple):
    """A booking's full ownership chain — booking, slot, service,
    organizer. Ownership is transitive (no organizerId on bookings), so
    every read scopes through the parent chain. Wire reads serialize it
    via db/serializers; notification jobs need exactly this (chat id,
    manage token, timezone — none carried by a wire DTO)."""

    booking: Booking
    slot: TimeSlot
    service: Service
    organizer: Organizer


_ChainSelect = Select[Booking, TimeSlot, Service, Organizer]


def _chain_select() -> _ChainSelect:
    return (
        select(Booking, TimeSlot, Service, Organizer)
        .join(TimeSlot, Booking.time_slot_id == TimeSlot.id)
        .join(Service, TimeSlot.service_id == Service.id)
        .join(Organizer, Service.organizer_id == Organizer.id)
    )


def _chain(row: Row[Booking, TimeSlot, Service, Organizer]) -> BookingChain:
    """One joined result row → the named chain: entity-attribute access,
    not positional unpacking."""
    return BookingChain(row.Booking, row.TimeSlot, row.Service, row.Organizer)


async def _chain_or_none(session: AsyncSession, stmt: _ChainSelect) -> BookingChain | None:
    row = (await session.execute(stmt.limit(1))).first()
    return _chain(row) if row is not None else None


async def atomic_reserve_seats(session: AsyncSession, slot_id: str, seats: int) -> TimeSlot | None:
    """The atomic seat reserve (invariant 1): a single conditional
    UPDATE — booked_count moves only when the capacity predicate holds.
    None means sold out (no row changed)."""
    stmt = (
        update(TimeSlot)
        .where(
            TimeSlot.id == slot_id,
            TimeSlot.booked_count + seats <= TimeSlot.capacity,
        )
        .values(booked_count=TimeSlot.booked_count + seats)
        .returning(TimeSlot)
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def release_seats_returning(
    session: AsyncSession, slot_id: str, seats: int
) -> TimeSlot | None:
    """Cancel-side release with the updated counter handed back
    (single round-trip — the caller maps it instead of re-reading)."""
    stmt = (
        update(TimeSlot)
        .where(TimeSlot.id == slot_id)
        .values(booked_count=func.greatest(0, TimeSlot.booked_count - seats))
        .returning(TimeSlot)
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def create_booking(session: AsyncSession, values: dict[str, Any]) -> Booking:
    result = await session.execute(pg_insert(Booking).values(**values).returning(Booking))
    return result.scalar_one()


async def insert_bookings(session: AsyncSession, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    await session.execute(pg_insert(Booking).values(rows))


async def delete_bookings_for_services(session: AsyncSession, service_ids: list[str]) -> None:
    """Seed-only: wholesale replacement of demo slots' bookings."""
    if not service_ids:
        return
    from sqlalchemy import delete

    slot_ids = select(TimeSlot.id).where(TimeSlot.service_id.in_(service_ids))
    await session.execute(delete(Booking).where(Booking.time_slot_id.in_(slot_ids)))


async def get_booking_chain_by_id(session: AsyncSession, booking_id: str) -> BookingChain | None:
    return await _chain_or_none(session, _chain_select().where(Booking.id == booking_id))


async def get_chain_by_manage_token_hash(
    session: AsyncSession, token_hash: str
) -> BookingChain | None:
    """Credential check via the SHA-256 hash (invariant 4) — the raw
    token column is never a predicate."""
    return await _chain_or_none(
        session, _chain_select().where(Booking.manage_token_hash == token_hash)
    )


async def list_guest_bookings(
    session: AsyncSession, messenger: str, messenger_id: str
) -> list[BookingChain]:
    """Every booking chain of one messenger identity, newest first —
    cancelled and expired-token rows included (guest history is never
    dropped; the DTO marks dead links canCancel=false)."""
    result = await session.execute(
        _chain_select()
        .where(
            Booking.guest_messenger == MessengerKind(messenger),
            Booking.guest_messenger_id == messenger_id,
        )
        .order_by(Booking.created_at.desc())
        .limit(200)
    )
    return [_chain(row) for row in result.all()]


async def get_owned_booking_chain(
    session: AsyncSession, organizer_id: str, booking_id: str
) -> BookingChain | None:
    """The full chain scoped through the owned-services join — a foreign
    id misses rather than leaks. The whole chain comes back because the
    caller (organizer cancel) needs the slot/service/organizer rows for
    post-commit work too."""
    return await _chain_or_none(
        session,
        _chain_select().where(Booking.id == booking_id, Service.organizer_id == organizer_id),
    )


async def cancel_booking_mark(session: AsyncSession, booking_id: str) -> Booking | None:
    """confirmed → cancelled transition. None means the row was already
    cancelled (or gone) — the caller maps it to AlreadyCancelled."""
    stmt = (
        update(Booking)
        .where(
            Booking.id == booking_id,
            Booking.status == BookingStatus.CONFIRMED,
        )
        .values(status=BookingStatus.CANCELLED)
        .returning(Booking)
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


# Column behind each `?sort=` key — the same joined values the cabinet
# table sorts by; text columns sort case-insensitively like the old
# client-side comparator did.
_SORT_COLUMNS: dict[str, ColumnElement[Any] | InstrumentedAttribute[Any]] = {
    "guest": func.lower(Booking.guest_name),
    "service": func.lower(Service.title),
    "when": TimeSlot.starts_at,
    "seats": Booking.seats,
    "status": Booking.status,
}


def _ilike_needle(q: str) -> str:
    """User text → a literal ILIKE needle: escape the wildcards first so
    a '%' in the search box cannot widen the match."""
    return f"%{q.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')}%"


async def list_by_organizer(
    session: AsyncSession,
    organizer_id: str,
    *,
    limit: int = 50,
    offset: int = 0,
    service_id: str | None = None,
    slot_id: str | None = None,
    status: str | None = None,
    q: str | None = None,
    day_range: tuple[datetime, datetime] | None = None,
    sort: str | None = None,
    sort_desc: bool = False,
) -> list[Booking]:
    """Bookings across the organizer's services — cancelled included
    (they are history, not noise). The filters mirror the cabinet's URL
    state: the scope narrows through the transitive join (a slot pins
    one session, a service follows Booking → TimeSlot → Service — there
    is no Booking.service_id), `day_range` is the caller's timezone
    conversion of a calendar day, `q` is a case-insensitive substring
    across the guest fields and the service title."""
    stmt = (
        select(Booking)
        .join(TimeSlot, Booking.time_slot_id == TimeSlot.id)
        .join(Service, TimeSlot.service_id == Service.id)
        .where(Service.organizer_id == organizer_id)
    )
    if slot_id is not None:
        stmt = stmt.where(Booking.time_slot_id == slot_id)
    if service_id is not None:
        stmt = stmt.where(TimeSlot.service_id == service_id)
    if status is not None:
        stmt = stmt.where(Booking.status == BookingStatus(status))
    if day_range is not None:
        day_from, day_to = day_range
        stmt = stmt.where(TimeSlot.starts_at >= day_from, TimeSlot.starts_at < day_to)
    if q is not None:
        needle = _ilike_needle(q)
        stmt = stmt.where(
            or_(
                Booking.guest_name.ilike(needle, escape="\\"),
                Booking.guest_messenger_login.ilike(needle, escape="\\"),
                Booking.guest_messenger_id.ilike(needle, escape="\\"),
                Service.title.ilike(needle, escape="\\"),
            )
        )
    column = _SORT_COLUMNS[sort] if sort is not None else None
    if column is not None:
        stmt = stmt.order_by(column.desc() if sort_desc else column.asc())
    else:
        stmt = stmt.order_by(Booking.created_at.desc())
    # Pagination needs a stable order: same-second created_at ties (and
    # equal sort keys) must not flip rows between pages.
    stmt = stmt.order_by(Booking.id).limit(limit).offset(offset)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def list_scoped_day_keys(
    session: AsyncSession,
    organizer_id: str,
    timezone: str,
    *,
    service_id: str | None = None,
    slot_id: str | None = None,
) -> list[str]:
    """`YYYY-MM-DD` day keys — in the organizer's timezone — whose
    sessions carry a booking inside the scope. Only the scope filters
    apply: the marks answer "when is anything booked", so status, day,
    search and sort deliberately do not narrow them."""
    day_expr = func.to_char(func.timezone(timezone, TimeSlot.starts_at), "YYYY-MM-DD")
    stmt = (
        select(day_expr)
        .select_from(Booking)
        .join(TimeSlot, Booking.time_slot_id == TimeSlot.id)
        .join(Service, TimeSlot.service_id == Service.id)
        .where(Service.organizer_id == organizer_id)
        .distinct()
        .order_by(day_expr)
    )
    if slot_id is not None:
        stmt = stmt.where(Booking.time_slot_id == slot_id)
    if service_id is not None:
        stmt = stmt.where(TimeSlot.service_id == service_id)
    result = await session.execute(stmt)
    return [str(row[0]) for row in result.all()]


async def overview_confirmed_counts(
    session: AsyncSession, organizer_id: str, *, recent_since: datetime
) -> tuple[int, int]:
    """(confirmed all-time, confirmed created since `recent_since`) —
    the overview's "confirmed bookings" card in one pass."""
    confirmed = Booking.status == BookingStatus.CONFIRMED
    stmt = (
        select(
            func.count().filter(confirmed),
            func.count().filter(confirmed & (Booking.created_at >= recent_since)),
        )
        .select_from(Booking)
        .join(TimeSlot, Booking.time_slot_id == TimeSlot.id)
        .join(Service, TimeSlot.service_id == Service.id)
        .where(Service.organizer_id == organizer_id)
    )
    total, recent = (await session.execute(stmt)).one()
    return int(total), int(recent)


async def count_confirmed_by_services(
    session: AsyncSession, service_ids: list[str]
) -> dict[str, int]:
    """Confirmed-booking counts per service id — one grouped query for
    the cabinet services list."""
    if not service_ids:
        return {}
    result = await session.execute(
        select(TimeSlot.service_id, func.count())
        .join(Booking, Booking.time_slot_id == TimeSlot.id)
        .where(
            TimeSlot.service_id.in_(service_ids),
            Booking.status == BookingStatus.CONFIRMED,
        )
        .group_by(TimeSlot.service_id)
    )
    return {str(service_id): int(total) for service_id, total in result.all()}


async def get_analytics_summary(
    session: AsyncSession,
    organizer_id: str,
    *,
    window_start: datetime,
    prev_window_start: datetime,
    trend_start: datetime,
) -> dict[str, int]:
    """Headline aggregates in one pass (times are the caller's rolling
    windows; ownership scopes through the slot join)."""
    confirmed = Booking.status == BookingStatus.CONFIRMED
    cancelled = Booking.status == BookingStatus.CANCELLED
    stmt = (
        select(
            func.count()
            .filter(confirmed & (Booking.created_at >= window_start))
            .label("total_bookings"),
            func.count()
            .filter(
                confirmed
                & (Booking.created_at >= prev_window_start)
                & (Booking.created_at < window_start)
            )
            .label("prev_total_bookings"),
            func.coalesce(
                func.sum(Booking.seats).filter(confirmed & (Booking.created_at >= window_start)),
                0,
            ).label("seats_sold"),
            func.coalesce(
                func.sum(Booking.seats).filter(
                    confirmed
                    & (Booking.created_at >= prev_window_start)
                    & (Booking.created_at < window_start)
                ),
                0,
            ).label("prev_seats_sold"),
            func.count().filter(Booking.created_at >= window_start).label("window_bookings"),
            func.count()
            .filter(cancelled & (Booking.created_at >= window_start))
            .label("cancelled_in_window"),
        )
        .select_from(Booking)
        .join(TimeSlot, Booking.time_slot_id == TimeSlot.id)
        .join(Service, TimeSlot.service_id == Service.id)
        .where(Service.organizer_id == organizer_id)
    )
    result = await session.execute(stmt)
    row = result.one()
    mapping = row._mapping
    return {key: int(mapping[key]) for key in mapping.keys()}


async def analytics_by_service(
    session: AsyncSession, organizer_id: str, *, window_start: datetime
) -> list[tuple[str, int]]:
    result = await session.execute(
        select(Service.title, func.count())
        .select_from(Booking)
        .join(TimeSlot, Booking.time_slot_id == TimeSlot.id)
        .join(Service, TimeSlot.service_id == Service.id)
        .where(
            Service.organizer_id == organizer_id,
            Booking.status == BookingStatus.CONFIRMED,
            Booking.created_at >= window_start,
        )
        .group_by(Service.title)
    )
    return [(str(title), int(total)) for title, total in result.all()]


async def analytics_trend(
    session: AsyncSession, organizer_id: str, *, trend_start: datetime
) -> list[tuple[datetime, int, int]]:
    """Per-day created_at buckets (UTC date via date_trunc) for the
    trend window — one grouped query, zero-filled by the caller."""
    confirmed_status = Booking.status == BookingStatus.CONFIRMED
    # Same expression object in SELECT and GROUP BY: two identical
    # func.date_trunc() calls compile to separate bound params ($1 vs
    # $2) and Postgres refuses to match them (GroupingError) — one
    # shared object renders one param used in both places.
    day_bucket = func.date_trunc("day", Booking.created_at).label("day")
    result = await session.execute(
        select(
            day_bucket,
            func.count().filter(confirmed_status).label("bookings"),
            func.coalesce(
                func.sum(Booking.seats).filter(confirmed_status),
                0,
            ).label("seats"),
        )
        .select_from(Booking)
        .join(TimeSlot, Booking.time_slot_id == TimeSlot.id)
        .join(Service, TimeSlot.service_id == Service.id)
        .where(
            Service.organizer_id == organizer_id,
            Booking.created_at >= trend_start,
        )
        .group_by(day_bucket)
    )
    out: list[tuple[datetime, int, int]] = []
    for row in result.all():
        day, bookings, seats = row
        if isinstance(day, datetime) and day.tzinfo is None:
            day = day.replace(tzinfo=UTC)
        out.append((day, int(bookings), int(seats)))
    return out
