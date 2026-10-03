"""Service repository: typed SQLAlchemy 2.0 queries over Service.

The merge-patch write path takes an explicit column-keyed dict
(touched values only) — Core update() instead of f-string SET
concatenation. Ownership (organizer_id) is part of every scoped
predicate, so a foreign id misses rather than leaks.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.booking import Booking
from ..models.organizer import Organizer
from ..models.service import Service
from ..models.time_slot import TimeSlot


async def list_by_organizer(
    session: AsyncSession, organizer_id: str, limit: int | None = None
) -> list[Service]:
    stmt = select(Service).where(Service.organizer_id == organizer_id).order_by(Service.created_at)
    if limit is not None:
        stmt = stmt.limit(limit)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_by_id(session: AsyncSession, service_id: str) -> Service | None:
    result = await session.execute(select(Service).where(Service.id == service_id))
    return result.scalar_one_or_none()


async def get_service_with_organizer(
    session: AsyncSession, service_id: str
) -> tuple[Service, Organizer] | None:
    """Service and its parent organizer in one join. The FK makes a
    dangling organizer impossible — the only miss is an unknown id,
    answered as one 404."""
    result = await session.execute(
        select(Service, Organizer)
        .join(Organizer, Service.organizer_id == Organizer.id)
        .where(Service.id == service_id)
        .limit(1)
    )
    row = result.first()
    if row is None:
        return None
    service, organizer = row
    return (service, organizer)


async def list_public_service_paths(session: AsyncSession) -> list[tuple[str, str]]:
    stmt = (
        select(Organizer.slug.label("org_slug"), Service.id.label("service_id"))
        .join(Organizer, Service.organizer_id == Organizer.id)
        .order_by(Organizer.slug, Service.id)
    )
    result = await session.execute(stmt)
    # Row unpacks directly (SQLAlchemy 2.1: tuples() is deprecated) —
    # named iteration, never positional row[i].
    return [(str(org_slug), str(service_id)) for org_slug, service_id in result.all()]


async def get_owned_service(
    session: AsyncSession, organizer_id: str, service_id: str
) -> Service | None:
    result = await session.execute(
        select(Service).where(Service.id == service_id, Service.organizer_id == organizer_id)
    )
    return result.scalar_one_or_none()


async def create_service(session: AsyncSession, values: dict[str, Any]) -> Service:
    result = await session.execute(pg_insert(Service).values(**values).returning(Service))
    return result.scalar_one()


async def update_service_merge_patch(
    session: AsyncSession,
    organizer_id: str,
    service_id: str,
    touched_values: dict[str, Any],
) -> Service | None:
    """Partial update of touched columns only — the caller maps wire
    fields to columns and explicit-null clears to None; an empty dict
    cannot produce `UPDATE … SET` with no assignments."""
    if not touched_values:
        return await get_owned_service(session, organizer_id, service_id)
    stmt = (
        update(Service)
        .where(Service.id == service_id, Service.organizer_id == organizer_id)
        .values(**touched_values)
        .returning(Service)
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def upsert_demo_service(session: AsyncSession, values: dict[str, Any]) -> None:
    stmt = pg_insert(Service).values(**values)
    stmt = stmt.on_conflict_do_update(
        index_elements=["id"],
        set_={
            "title": stmt.excluded.title,
            "description": stmt.excluded.description,
            "photo_url": stmt.excluded.photo_url,
            "location": stmt.excluded.location,
            "contact": stmt.excluded.contact,
            "default_price": stmt.excluded.default_price,
            "default_capacity": stmt.excluded.default_capacity,
            "default_duration_minutes": stmt.excluded.default_duration_minutes,
            "max_seats_per_booking": stmt.excluded.max_seats_per_booking,
            "options": stmt.excluded.options,
            "options_select_mode": stmt.excluded.options_select_mode,
        },
    )
    await session.execute(stmt)


async def count_bookings_for_service(session: AsyncSession, service_id: str) -> int:
    """Every booking row referencing the service's slots — confirmed or
    cancelled (the 409 guard counts history, not just active rows)."""
    result = await session.execute(
        select(func.count())
        .select_from(Booking)
        .join(TimeSlot, Booking.time_slot_id == TimeSlot.id)
        .where(TimeSlot.service_id == service_id)
    )
    return int(result.scalar_one())


async def get_owned_service_for_update(
    session: AsyncSession, organizer_id: str, service_id: str
) -> Service | None:
    """Owned service row under FOR UPDATE — serializes against a
    concurrent service delete."""
    stmt = (
        select(Service)
        .where(Service.id == service_id, Service.organizer_id == organizer_id)
        .limit(1)
        .with_for_update()
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def delete_owned_service(
    session: AsyncSession, organizer_id: str, service_id: str
) -> Service | None:
    """DELETE … RETURNING the row so the caller keeps photo_url for the
    post-commit R2 cleanup without a second read."""
    from sqlalchemy import delete

    stmt = (
        delete(Service)
        .where(Service.id == service_id, Service.organizer_id == organizer_id)
        .returning(Service)
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()
