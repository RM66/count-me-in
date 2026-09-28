"""Standalone slot db-layer tests: direct slot queries, updates and the
delete guard, against the live Postgres — the booking-write tests cover
slots only as fixtures of the booking flow; this module pins the slot
operations themselves (ownership scoping, the capacity precheck, the
merge-patch update contract, the delete guard).

Requires POSTGRES_URL — skipped locally without it, failed in CI (the
shared rule in tests_py/_env.py).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from countmein.contracts import models_gen as gen
from countmein.db import time_slot as slot_db
from countmein.db.client import engine
from countmein.db.shared import TouchedUpdate, new_id, new_service_id
from countmein.errors import CapacityBelowBooked, DemoReadOnly, NothingToUpdate
from sqlalchemy import text

# Every test needs the live Postgres — the whole module is integration.
pytestmark = pytest.mark.integration


def require_postgres() -> None:
    from _env import require_postgres as _require

    _require()


async def _fixture() -> tuple[str, str, str]:
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
                "starts_at": datetime.now(UTC) + timedelta(hours=48),
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
        rows = await slot_db.list_slots(org_id, upcoming_only=False)
        assert [r.id for r in rows] == [slot_id], "only the owner's slots, earliest first"
        assert not any(r.id == slot_id for r in await slot_db.list_slots(other_org, False))
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
    rows = await slot_db.list_slots(org_id, upcoming_only=True)
    assert [r.id for r in rows] == [slot_id], "the past slot is dropped"


async def test_get_owned_slot_hides_foreign_ids(fx):
    org_id, _service_id, slot_id = fx
    other_org, _, _ = await _fixture()
    try:
        assert (await slot_db.get_owned_slot(org_id, slot_id)) is not None
        # A foreign organizer must not see the slot — None, like unknown.
        assert await slot_db.get_owned_slot(other_org, slot_id) is None
        assert await slot_db.get_owned_slot(org_id, new_id()) is None
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
        assert await slot_db.create_slot(org_id, payload) is None, (
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
        await slot_db.create_slot(DEMO_ORGANIZER_ID, payload)


async def test_update_owned_slot_tx_touches_only_touched_columns(fx):
    org_id, _service_id, slot_id = fx
    state = gen.UpdateTimeSlotInput(
        startsAt=None, durationMinutes=90, capacity=None, price="12 EUR"
    )
    touched = {"startsAt": False, "durationMinutes": True, "capacity": False, "price": True}
    async with engine().begin() as conn:
        row = await slot_db.update_owned_slot_tx(
            conn, org_id, slot_id, TouchedUpdate(state, touched)
        )
    assert row is not None
    assert row.duration_minutes == 90
    assert row.price == "12 EUR"
    # Untouched columns keep their values.
    assert row.capacity == 10


async def test_update_owned_slot_tx_capacity_below_booked_is_409(fx):
    org_id, _service_id, slot_id = fx
    async with engine().begin() as conn:
        await conn.execute(
            text("UPDATE time_slots SET booked_count = 5 WHERE id = :id"), {"id": slot_id}
        )
    state = gen.UpdateTimeSlotInput(startsAt=None, durationMinutes=None, capacity=4, price=None)
    touched = {"startsAt": False, "durationMinutes": False, "capacity": True, "price": False}
    async with engine().begin() as conn:
        with pytest.raises(CapacityBelowBooked):
            await slot_db.update_owned_slot_tx(conn, org_id, slot_id, TouchedUpdate(state, touched))


async def test_update_owned_slot_tx_nothing_touched_raises(fx):
    org_id, _service_id, slot_id = fx
    state = gen.UpdateTimeSlotInput(startsAt=None, durationMinutes=None, capacity=None, price=None)
    touched = {"startsAt": False, "durationMinutes": False, "capacity": False, "price": False}
    async with engine().begin() as conn:
        with pytest.raises(NothingToUpdate):
            await slot_db.update_owned_slot_tx(conn, org_id, slot_id, TouchedUpdate(state, touched))


async def test_update_owned_slot_tx_foreign_organizer_answers_none(fx):
    _org_id, _service_id, slot_id = fx
    other_org, _, _ = await _fixture()
    try:
        state = gen.UpdateTimeSlotInput(
            startsAt=None, durationMinutes=45, capacity=None, price=None
        )
        touched = {"startsAt": False, "durationMinutes": True, "capacity": False, "price": False}
        async with engine().begin() as conn:
            assert (
                await slot_db.update_owned_slot_tx(
                    conn, other_org, slot_id, TouchedUpdate(state, touched)
                )
                is None
            ), "a foreign update must answer None, not leak the row"
    finally:
        await _cleanup(other_org)


async def test_delete_owned_slot_success_and_unknown(fx):
    org_id, _service_id, slot_id = fx
    assert await slot_db.delete_owned_slot(org_id, slot_id) == slot_id
    # Second delete: nothing matched.
    assert await slot_db.delete_owned_slot(org_id, slot_id) is None
    assert await slot_db.delete_owned_slot(org_id, new_id()) is None


async def test_delete_owned_slot_foreign_organizer_answers_none(fx):
    org_id, _service_id, slot_id = fx
    other_org, _, _ = await _fixture()
    try:
        assert await slot_db.delete_owned_slot(other_org, slot_id) is None
        # The slot survives.
        assert await slot_db.get_owned_slot(org_id, slot_id) is not None
    finally:
        await _cleanup(other_org)
