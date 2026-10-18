"""UPDATE … RETURNING must hand back the database row, not the identity
map.

Every occupancy path loads the slot first (validation / FOR UPDATE), so
the ORM object is already mapped when the UPDATE runs. A plain
``returning()`` yields that unrefreshed object — a concurrent write
between our SELECT and UPDATE is invisible unless ``populate_existing``
makes RETURNING authoritative.

Each test reproduces the race with two sessions: A maps the row, B
commits a write, A runs its UPDATE — without the option the returned
values lag the database.

Requires POSTGRES_URL — skipped locally without it, failed in CI.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from countmein.db.client import engine, sessionmaker
from countmein.db.shared import new_id, new_service_id
from countmein.models.time_slot import TimeSlot
from countmein.repositories import booking_repo, slot_repo
from sqlalchemy import text

pytestmark = pytest.mark.integration


def _require_postgres() -> None:
    from _env import require_postgres

    require_postgres()


async def _fixture() -> tuple[str, str, str]:
    """(organizer_id, service_id, slot_id), cleaned up by cascade from
    the organizer row."""
    _require_postgres()
    organizer_id, service_id, slot_id = new_id(), new_service_id(), new_id()
    suffix = organizer_id[-12:]
    async with engine().begin() as conn:
        await conn.execute(
            text(
                """
                INSERT INTO organizers (id, slug, name, messenger, messenger_id, timezone, language)
                VALUES (:id, :slug, 'RT Organizer', 'telegram', :messenger_id, 'Europe/Belgrade', 'en')
                """
            ),
            {"id": organizer_id, "slug": "rt-" + suffix, "messenger_id": "rt-" + suffix},
        )
        await conn.execute(
            text(
                """
                INSERT INTO services (id, organizer_id, title, default_price, default_capacity,
                    default_duration_minutes, max_seats_per_booking)
                VALUES (:id, :org_id, 'RT Service', '10 EUR', 10, 60, 4)
                """
            ),
            {"id": service_id, "org_id": organizer_id},
        )
        await conn.execute(
            text(
                """
                INSERT INTO time_slots (id, service_id, starts_at, duration_minutes, capacity, booked_count)
                VALUES (:id, :service_id, :starts_at, 60, 10, 0)
                """
            ),
            {
                "id": slot_id,
                "service_id": service_id,
                "starts_at": datetime.now(UTC) + timedelta(hours=48),
            },
        )
    return organizer_id, service_id, slot_id


async def _cleanup(organizer_id: str) -> None:
    async with engine().begin() as conn:
        await conn.execute(text("DELETE FROM organizers WHERE id = :id"), {"id": organizer_id})


async def test_atomic_reserve_returns_the_row_not_the_mapped_snapshot():
    """Concurrent reserve lands between the caller's read and its UPDATE:
    the returned slot must carry the bumped counter, not the stale
    identity-map snapshot."""
    org_id, _, slot_id = await _fixture()
    try:
        async with sessionmaker()() as session_a, sessionmaker()() as session_b:
            # Session A maps the row the way the booking route does
            # (plain SELECT for validation before the reserve).
            await session_a.get(TimeSlot, slot_id)

            # Session B wins the race — its commit lands first.
            await booking_repo.atomic_reserve_seats(session_b, slot_id, 1)
            await session_b.commit()

            row = await booking_repo.atomic_reserve_seats(session_a, slot_id, 1)
            assert row is not None
            # DB truth is booked_count=2 — anything older means the
            # returned object stayed on the pre-update snapshot.
            assert row.booked_count == 2
            await session_a.commit()
    finally:
        await _cleanup(org_id)


async def test_release_seats_returns_the_row_not_the_mapped_snapshot():
    org_id, _, slot_id = await _fixture()
    try:
        async with sessionmaker()() as session_a, sessionmaker()() as session_b:
            await booking_repo.atomic_reserve_seats(session_b, slot_id, 2)
            await session_b.commit()

            # Session A maps the row at booked=2, then B takes one seat more
            # (booked=3) before A's cancel-side release runs.
            await session_a.get(TimeSlot, slot_id)
            await booking_repo.atomic_reserve_seats(session_b, slot_id, 1)
            await session_b.commit()

            row = await booking_repo.release_seats_returning(session_a, slot_id, 2)
            assert row is not None
            assert row.booked_count == 1
            await session_a.commit()
    finally:
        await _cleanup(org_id)


async def test_merge_patch_returns_the_row_not_the_mapped_snapshot():
    """A concurrent reserve lands before the capacity patch's UPDATE —
    RETURNING with populate_existing refreshes the mapped row."""
    org_id, _, slot_id = await _fixture()
    try:
        async with sessionmaker()() as session_a, sessionmaker()() as session_b:
            # Map the row at booked=0, then a guest's reserve lands first.
            await session_a.get(TimeSlot, slot_id)
            await booking_repo.atomic_reserve_seats(session_b, slot_id, 1)
            await session_b.commit()

            row = await slot_repo.update_slot_merge_patch(
                session_a,
                org_id,
                slot_id,
                {"capacity": 8},
            )
            assert row is not None
            assert (row.capacity, row.booked_count) == (8, 1)
            await session_a.commit()
    finally:
        await _cleanup(org_id)
