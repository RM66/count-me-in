"""Time-slot repository: typed SQLAlchemy 2.0 queries over TimeSlot."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.booking import Booking
from ..models.organizer import Organizer
from ..models.service import Service
from ..models.time_slot import TimeSlot


async def list_by_organizer(
    session: AsyncSession,
    organizer_id: str,
    upcoming_only: bool = False,
    until_time: datetime | None = None,
) -> list[TimeSlot]:
    """Slots across all of the organizer's services (cabinet list).
    `until_time` bounds the upper end — a schedule years deep must not
    stream unbounded rows."""
    stmt = (
        select(TimeSlot)
        .join(Service, TimeSlot.service_id == Service.id)
        .where(Service.organizer_id == organizer_id)
        .order_by(TimeSlot.starts_at)
    )
    if upcoming_only:
        stmt = stmt.where(TimeSlot.starts_at >= func.now())
    if until_time is not None:
        stmt = stmt.where(TimeSlot.starts_at <= until_time)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def list_upcoming_by_services(
    session: AsyncSession,
    service_ids: list[str],
    from_time: datetime,
    until_time: datetime | None = None,
    limit: int | None = None,
) -> list[TimeSlot]:
    """Upcoming slots across services in [from_time, until_time] — the
    rolling-horizon window public reads apply (ADR-023 Phase 2) so a
    deep schedule cannot grow the payload unboundedly."""
    if not service_ids:
        return []
    stmt = (
        select(TimeSlot)
        .where(TimeSlot.service_id.in_(service_ids), TimeSlot.starts_at >= from_time)
        .order_by(TimeSlot.starts_at)
    )
    if until_time is not None:
        stmt = stmt.where(TimeSlot.starts_at <= until_time)
    if limit is not None:
        stmt = stmt.limit(limit)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def count_upcoming_by_services(
    session: AsyncSession, service_ids: list[str], from_time: datetime
) -> dict[str, int]:
    if not service_ids:
        return {}
    stmt = (
        select(TimeSlot.service_id, func.count())
        .where(TimeSlot.service_id.in_(service_ids), TimeSlot.starts_at >= from_time)
        .group_by(TimeSlot.service_id)
    )
    result = await session.execute(stmt)
    return {str(service_id): int(cnt) for service_id, cnt in result.all()}


async def get_slot_chain_for_booking(
    session: AsyncSession, slot_id: str, service_id: str
) -> tuple[TimeSlot, Service, Organizer] | None:
    """The chain create_guest_booking needs: slot + parents, future
    only — the starts_at predicate lives in SQL so a past slot answers
    like a missing one (SlotGone → 404)."""
    stmt = (
        select(TimeSlot, Service, Organizer)
        .join(Service, TimeSlot.service_id == Service.id)
        .join(Organizer, Service.organizer_id == Organizer.id)
        .where(
            TimeSlot.id == slot_id,
            Service.id == service_id,
            TimeSlot.starts_at > func.now(),
        )
        .limit(1)
    )
    result = await session.execute(stmt)
    row = result.first()
    if row is None:
        return None
    slot, service, organizer = row
    return (slot, service, organizer)


async def get_owned_slot_for_update(
    session: AsyncSession, organizer_id: str, slot_id: str
) -> TimeSlot | None:
    """Owned slot row under FOR UPDATE — serializes the capacity
    precheck and delete guard against the atomic reserve, which a plain
    SELECT under READ COMMITTED cannot do."""
    stmt = (
        select(TimeSlot)
        .join(Service, TimeSlot.service_id == Service.id)
        .where(TimeSlot.id == slot_id, Service.organizer_id == organizer_id)
        .limit(1)
        .with_for_update()
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def get_owned_slot(session: AsyncSession, organizer_id: str, slot_id: str) -> TimeSlot | None:
    stmt = (
        select(TimeSlot)
        .join(Service, TimeSlot.service_id == Service.id)
        .where(TimeSlot.id == slot_id, Service.organizer_id == organizer_id)
        .limit(1)
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def create_slot(session: AsyncSession, values: dict[str, Any]) -> TimeSlot:
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    result = await session.execute(pg_insert(TimeSlot).values(**values).returning(TimeSlot))
    return result.scalar_one()


async def insert_slots(session: AsyncSession, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    await session.execute(pg_insert(TimeSlot).values(rows))


async def update_slot_merge_patch(
    session: AsyncSession, organizer_id: str, slot_id: str, touched_values: dict[str, Any]
) -> TimeSlot | None:
    """Partial update of touched columns only. Ownership is enforced by
    joining the parent service — a foreign slot id misses rather than
    leaks."""
    slot_ids = (
        select(TimeSlot.id)
        .join(Service, TimeSlot.service_id == Service.id)
        .where(TimeSlot.id == slot_id, Service.organizer_id == organizer_id)
    )
    stmt = (
        update(TimeSlot)
        .where(TimeSlot.id.in_(slot_ids))
        .values(**touched_values)
        .returning(TimeSlot)
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def count_bookings_for_slot(session: AsyncSession, slot_id: str) -> int:
    """Every booking row on the slot — confirmed or cancelled (the 409
    guard counts guest history, not just active rows)."""
    result = await session.execute(
        select(func.count()).select_from(Booking).where(Booking.time_slot_id == slot_id)
    )
    return int(result.scalar_one())


async def delete_slot(session: AsyncSession, organizer_id: str, slot_id: str) -> str | None:
    """Owned DELETE — no RETURNING needed, the id is the answer. A stray
    23503 (FK RESTRICT) maps to the same 409 as the pre-count; the
    caller owns that mapping."""
    slot_ids = (
        select(TimeSlot.id)
        .join(Service, TimeSlot.service_id == Service.id)
        .where(TimeSlot.id == slot_id, Service.organizer_id == organizer_id)
    )
    result = await session.execute(delete(TimeSlot).where(TimeSlot.id.in_(slot_ids)))
    if int(getattr(result, "rowcount", 0) or 0) == 0:
        return None
    return slot_id


async def delete_slots_for_services(session: AsyncSession, service_ids: list[str]) -> None:
    if not service_ids:
        return
    await session.execute(delete(TimeSlot).where(TimeSlot.service_id.in_(service_ids)))
