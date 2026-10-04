"""Standalone slot service tests against live Postgres — the
booking-write tests cover slots only as booking fixtures; this module
pins the slot operations themselves (ownership scoping, the capacity
precheck, the merge-patch update contract, the delete guard, the
rolling horizon).

Requires POSTGRES_URL — skipped locally without it, failed in CI.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from countmein.contracts import models_gen as gen
from countmein.db.client import engine, sessionmaker
from countmein.db.shared import new_id, new_service_id
from countmein.errors import CapacityBelowBooked, DemoReadOnly
from countmein.models.time_slot import TimeSlot
from countmein.repositories import slot_repo
from countmein.services import slot_service as slot_svc
from sqlalchemy import text

from ._helpers import svc

# Every test needs the live Postgres — the whole module is integration.
pytestmark = pytest.mark.integration


def require_postgres() -> None:
    from _env import require_postgres as _require

    _require()


async def _fixture(starts_at: datetime | None = None) -> tuple[str, str, str]:
    """(organizer_id, service_id, slot_id) — one organizer + service +
    one future slot, unique per run. Cleanup cascades from the
    organizer row."""
    require_postgres()
    organizer_id = new_id()
    service_id = new_service_id()
    slot_id = new_id()
    suffix = organizer_id[-12:]
    async with engine().begin() as conn:
        await conn.execute(
            text(
                """
                INSERT INTO organizers (id, slug, name, messenger, messenger_id, timezone, language)
                VALUES (:id, :slug, 'IT Organizer', 'telegram', :messenger_id, 'Europe/Belgrade', 'en')
                """
            ),
            {"id": organizer_id, "slug": "it-slot-" + suffix, "messenger_id": "it-" + suffix},
        )
        await conn.execute(
            text(
                """
                INSERT INTO services (id, organizer_id, title, default_price, default_capacity,
                    default_duration_minutes, max_seats_per_booking)
                VALUES (:id, :org_id, 'IT Service', '10 EUR', 10, 60, 4)
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
                "starts_at": starts_at or datetime.now(UTC) + timedelta(hours=48),
            },
        )
    return organizer_id, service_id, slot_id


async def _cleanup(organizer_id: str) -> None:
    async with engine().begin() as conn:
        await conn.execute(text("DELETE FROM organizers WHERE id = :id"), {"id": organizer_id})


@pytest.fixture()
async def fx():
    org_id, service_id, slot_id = await _fixture()
    yield org_id, service_id, slot_id
    await _cleanup(org_id)


async def test_list_slots_scopes_to_owner_and_orders(fx):
    org_id, _service_id, slot_id = fx
    other_org, _, _ = await _fixture()
    try:
        rows = await svc(slot_repo.list_by_organizer, org_id, False)
        assert [r.id for r in rows] == [slot_id], "only the owner's slots, earliest first"
        assert not any(
            r.id == slot_id for r in await svc(slot_repo.list_by_organizer, other_org, False)
        )
    finally:
        await _cleanup(other_org)


async def test_list_slots_upcoming_only_drops_past(fx):
    org_id, service_id, slot_id = fx
    past_id = new_id()
    async with engine().begin() as conn:
        await conn.execute(
            text(
                """
                INSERT INTO time_slots (id, service_id, starts_at, duration_minutes, capacity, booked_count)
                VALUES (:id, :service_id, :starts_at, 60, 10, 0)
                """
            ),
            {
                "id": past_id,
                "service_id": service_id,
                "starts_at": datetime.now(UTC) - timedelta(hours=2),
            },
        )
    rows = await svc(slot_repo.list_by_organizer, org_id, True)
    assert [r.id for r in rows] == [slot_id], "the past slot is dropped"


async def test_public_slots_bounded_by_horizon():
    """The rolling public horizon: a slot further out than now + 90 days
    stays in the DB and on the cabinet's list, but the public upcoming
    read must not return it — a schedule seeded seasons ahead must not
    grow the public payload (ADR-023 Phase 2). The cabinet list is
    deliberately unbounded."""
    from countmein.repositories import slot_repo
    from countmein.services.slot_service import SLOT_HORIZON

    org_id, service_id, slot_id = await _fixture()
    far_id = new_id()
    try:
        async with engine().begin() as conn:
            await conn.execute(
                text(
                    """
                    INSERT INTO time_slots (id, service_id, starts_at, duration_minutes, capacity, booked_count)
                    VALUES (:id, :service_id, :starts_at, 60, 10, 0)
                    """
                ),
                {
                    "id": far_id,
                    "service_id": service_id,
                    "starts_at": datetime.now(UTC) + timedelta(days=120),
                },
            )

        # Cabinet list: both slots — the organizer sees the whole schedule.
        rows = await svc(slot_repo.list_by_organizer, org_id, False)
        assert {r.id for r in rows} == {slot_id, far_id}

        # The public read (same query the public routes run): the +120d
        # slot is beyond the horizon, the +48h one is listed.
        now = datetime.now(UTC)
        async with sessionmaker()() as session:
            public = await slot_repo.list_upcoming_by_services(
                session, [service_id], now, until_time=now + SLOT_HORIZON
            )
        assert [str(s.id) for s in public] == [slot_id]
    finally:
        await _cleanup(org_id)


async def test_get_owned_slot_hides_foreign_ids(fx):
    org_id, _service_id, slot_id = fx
    other_org, _, _ = await _fixture()
    try:
        assert (await svc(slot_repo.get_owned_slot, org_id, slot_id)) is not None
        # A foreign organizer must not see the slot — None, like unknown.
        assert await svc(slot_repo.get_owned_slot, other_org, slot_id) is None
        assert await svc(slot_repo.get_owned_slot, org_id, new_id()) is None
    finally:
        await _cleanup(other_org)


async def test_create_slot_under_foreign_service_answers_none(fx):
    org_id, _service_id, _slot_id = fx
    other_org, other_service, _ = await _fixture()
    try:
        payload = gen.CreateTimeSlotInput(
            serviceId=other_service,  # type: ignore[arg-type]
            startsAt=datetime.now(UTC).isoformat(),  # type: ignore[arg-type]
            durationMinutes=60,
            capacity=5,
        )
        assert await svc(slot_svc.create_slot, org_id, payload) is None, (
            "a foreign service id must answer None (the caller 404s without confirming it)"
        )
    finally:
        await _cleanup(other_org)


async def test_create_slot_demo_refused(fx):
    from countmein.contracts.constants_gen import DEMO_ORGANIZER_ID

    payload = gen.CreateTimeSlotInput(
        serviceId="service-id-123",  # type: ignore[arg-type]
        startsAt=datetime.now(UTC).isoformat(),  # type: ignore[arg-type]
        durationMinutes=60,
        capacity=5,
    )
    with pytest.raises(DemoReadOnly):
        await svc(slot_svc.create_slot, DEMO_ORGANIZER_ID, payload)


async def test_update_owned_slot_touches_only_touched_columns(fx):
    org_id, _service_id, slot_id = fx
    async with sessionmaker()() as session, session.begin():
        current = await slot_repo.get_owned_slot_for_update(session, org_id, slot_id)
        assert current is not None
        row = await slot_svc.update_owned_slot(
            session,
            org_id,
            slot_id,
            current,
            {"duration_minutes": 90, "price": "12 EUR"},
        )
    assert row is not None
    assert row.duration_minutes == 90
    assert row.price == "12 EUR"
    # Untouched columns keep their values.
    assert row.capacity == 10


async def test_update_owned_slot_capacity_below_booked_is_409(fx):
    org_id, _service_id, slot_id = fx
    async with engine().begin() as conn:
        await conn.execute(
            text("UPDATE time_slots SET booked_count = 5 WHERE id = :id"), {"id": slot_id}
        )
    async with sessionmaker()() as session, session.begin():
        current = await slot_repo.get_owned_slot_for_update(session, org_id, slot_id)
        assert current is not None
        with pytest.raises(CapacityBelowBooked):
            await slot_svc.update_owned_slot(session, org_id, slot_id, current, {"capacity": 4})


async def test_update_owned_slot_foreign_organizer_answers_none(fx):
    _org_id, _service_id, slot_id = fx
    other_org, _, _ = await _fixture()
    try:
        async with sessionmaker()() as session, session.begin():
            assert await slot_repo.get_owned_slot_for_update(session, other_org, slot_id) is None
        async with sessionmaker()() as session, session.begin():
            assert (
                await slot_svc.update_owned_slot(
                    session, other_org, slot_id, TimeSlot(), {"duration_minutes": 45}
                )
                is None
            ), "a foreign update must answer None, not leak the row"
    finally:
        await _cleanup(other_org)


async def test_delete_owned_slot_success_and_unknown(fx):
    org_id, _service_id, slot_id = fx
    deleted = await svc(slot_svc.delete_owned_slot, org_id, slot_id)
    assert deleted is not None and deleted.id == slot_id
    # Second delete: nothing matched.
    assert await svc(slot_svc.delete_owned_slot, org_id, slot_id) is None
    assert await svc(slot_svc.delete_owned_slot, org_id, new_id()) is None


async def test_delete_owned_slot_foreign_organizer_answers_none(fx):
    org_id, _service_id, slot_id = fx
    other_org, _, _ = await _fixture()
    try:
        assert await svc(slot_svc.delete_owned_slot, other_org, slot_id) is None
        # The slot survives.
        assert await svc(slot_repo.get_owned_slot, org_id, slot_id) is not None
    finally:
        await _cleanup(other_org)
