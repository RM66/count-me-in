"""Server-side reads, writes and DTO mapping for time slots. Ownership
is transitive: a slot belongs to a service, the service to an organizer
(invariant 5), so every statement scopes through the parent service with
an owned-services subquery in the WHERE clause.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from ..contracts import domain
from ..contracts.models import unwrap_root
from ..demo import refuse_demo_write
from .client import engine
from .errors import (
    CapacityBelowBooked,
    NothingToUpdate,
    SlotHasActiveBookings,
)
from .rows import SLOT_COLUMNS, TimeSlotRow, scan_slot
from .shared import is_foreign_key_violation, new_id

_OWNED_SERVICES = "SELECT id FROM services WHERE organizer_id = :org_id"


def _slot_starts_at_time(s: Any) -> Any:
    """Extract the instant behind the generated oneOf wrapper (ISO string
    or epoch)."""
    return domain.parse_flex_time(unwrap_root(s))


async def list_slots(organizer_id: str, upcoming_only: bool) -> list[TimeSlotRow]:
    """Every slot across an organizer's services, earliest first.
    upcoming_only drops slots that have already started (the cabinet list
    is a schedule, past sessions are noise there).

    Bounded: a schedule years deep must not stream unbounded rows into
    one response. The cabinet paginates client-side today; the cap is
    the server-side backstop."""
    query = (
        f"SELECT ts.id, ts.service_id, ts.starts_at, ts.duration_minutes, ts.capacity, "
        "ts.booked_count, ts.price, ts.created_at "
        "FROM time_slots ts "
        f"WHERE ts.service_id IN ({_OWNED_SERVICES})"
    )
    if upcoming_only:
        query += " AND ts.starts_at >= now()"
    query += " ORDER BY ts.starts_at ASC LIMIT 500"
    async with engine().connect() as conn:
        result = await conn.execute(text(query), {"org_id": organizer_id})
        return [s for s in (scan_slot(r) for r in result) if s is not None]


async def get_owned_slot(organizer_id: str, slot_id: str) -> TimeSlotRow | None:
    """None when the id does not exist *or* hangs off another
    organizer's service, so callers cannot leak a foreign slot by
    guessing ids."""
    async with engine().connect() as conn:
        return await get_owned_slot_tx(conn, organizer_id, slot_id)


async def get_owned_slot_tx(
    conn: AsyncConnection, organizer_id: str, slot_id: str
) -> TimeSlotRow | None:
    result = await conn.execute(
        text(
            f"SELECT {SLOT_COLUMNS} FROM time_slots "
            f"WHERE id = :slot_id AND service_id IN ({_OWNED_SERVICES}) LIMIT 1"
        ),
        {"slot_id": slot_id, "org_id": organizer_id},
    )
    return scan_slot(result.first())


async def create_slot(organizer_id: str, payload: Any) -> TimeSlotRow | None:
    """Under a service owned by organizer_id; None when the parent
    service does not exist or belongs to someone else (the caller
    answers 404 without ever confirming a foreign id). Ownership is
    confirmed by a SELECT before the insert (the id is generated
    app-side, an INSERT…SELECT would skip it; the gap that opens is
    harmless — if the service disappears in between, the FK rejects the
    row)."""
    refuse_demo_write(organizer_id)
    # begin() — the INSERT must commit; a bare connect() rolls the
    # implicit transaction back on close and the slot silently vanishes.
    async with engine().begin() as conn:
        result = await conn.execute(
            text("SELECT id FROM services WHERE id = :sid AND organizer_id = :org_id LIMIT 1"),
            {"sid": str(unwrap_root(payload.serviceId)), "org_id": organizer_id},
        )
        owned = result.first()
        if owned is None:
            return None

        starts_at = _slot_starts_at_time(payload.startsAt)
        try:
            result = await conn.execute(
                text(
                    f"""
                    INSERT INTO time_slots (id, service_id, starts_at, duration_minutes, capacity, price)
                    VALUES (:id, :sid, :starts_at, :duration, :capacity, :price)
                    RETURNING {SLOT_COLUMNS}
                    """
                ),
                {
                    "id": new_id(),
                    "sid": owned[0],
                    "starts_at": starts_at,
                    "duration": int(unwrap_root(payload.durationMinutes)),
                    "capacity": int(unwrap_root(payload.capacity)),
                    "price": unwrap_root(payload.price),
                },
            )
        except Exception as err:
            # The ownership check and the INSERT are not one snapshot: a
            # service deleted in between surfaces as 23503, which must read
            # as "not found", never a bare 500.
            if is_foreign_key_violation(err):
                return None
            raise
        return scan_slot(result.first())


async def update_owned_slot_tx(
    conn: AsyncConnection, organizer_id: str, slot_id: str, update: Any
) -> TimeSlotRow | None:
    """booked_count is deliberately not updatable: seats move only
    through the atomic reserve in the booking flow (invariant 2).
    Shrinking capacity below the seats already sold answers a 409. Runs
    on a caller-supplied transaction: the merge-patch route opens the
    tx, reads the current state, merges, and calls this on the same tx —
    the capacity precheck's FOR UPDATE lock then also serializes
    against concurrent merge-patch reads of the same row."""
    refuse_demo_write(organizer_id)
    sets: list[str] = []
    args: dict[str, Any] = {"slot_id": slot_id, "org_id": organizer_id}

    def add(col: str, key: str, value: Any) -> None:
        sets.append(f"{col} = :{key}")
        args[key] = value

    state = update.state
    touched = update.touched
    if touched.get("startsAt") and state.startsAt is not None:
        add("starts_at", "starts_at", _slot_starts_at_time(state.startsAt))
    if touched.get("durationMinutes") and state.durationMinutes is not None:
        add("duration_minutes", "duration", int(unwrap_root(state.durationMinutes)))
    if touched.get("capacity") and state.capacity is not None:
        add("capacity", "capacity", int(unwrap_root(state.capacity)))
    if touched.get("price"):
        if state.price is not None:
            add("price", "price", str(unwrap_root(state.price)))
        else:
            sets.append("price = NULL")
    if not sets:
        raise NothingToUpdate()

    scope = f"id = :slot_id AND service_id IN ({_OWNED_SERVICES})"

    # Capacity precheck inside the same tx, under a row lock: a plain
    # SELECT takes no lock under READ COMMITTED, so the check could race
    # the booking flow's atomic reserve. FOR UPDATE serializes against
    # it — an improvement on the TS version, whose backstop is the
    # booked_count CHECK constraint surfacing as an opaque 23514.
    if touched.get("capacity") and state.capacity is not None:
        result = await conn.execute(
            text(f"SELECT booked_count FROM time_slots WHERE {scope} FOR UPDATE"),
            args,
        )
        row = result.first()
        if row is None:
            return None
        if state.capacity < row[0]:
            raise CapacityBelowBooked(booked_count=row[0])

    query = f"UPDATE time_slots SET {', '.join(sets)} WHERE {scope} RETURNING {SLOT_COLUMNS}"
    result = await conn.execute(text(query), args)
    return scan_slot(result.first())


async def delete_owned_slot(organizer_id: str, slot_id: str) -> str | None:
    """Refuse to delete a slot that is referenced by any booking row,
    confirmed or cancelled (the time_slots FK is ON DELETE RESTRICT, so
    the database would reject the delete anyway; failing here turns the
    opaque FK error into a 409 the organizer can act on). The guard must
    be at least as wide as the constraint: counting only confirmed
    bookings would let a cancelled-only slot fall through to a raw 23503
    and a bare 500. Returns None when nothing matched."""
    refuse_demo_write(organizer_id)
    async with engine().begin() as conn:
        # Lock the slot row so the check and delete are atomic against the
        # booking flow's reserve. A plain SELECT takes no lock under READ
        # COMMITTED, so a booking could land between the check and the
        # delete; FOR UPDATE serializes against it.
        result = await conn.execute(
            text(
                f"SELECT id FROM time_slots WHERE id = :slot_id "
                f"AND service_id IN ({_OWNED_SERVICES}) FOR UPDATE"
            ),
            {"slot_id": slot_id, "org_id": organizer_id},
        )
        row = result.first()
        if row is None:
            return None

        result = await conn.execute(
            text("SELECT count(*) FROM bookings WHERE time_slot_id = :slot_id"),
            {"slot_id": slot_id},
        )
        if result.scalar_one() > 0:
            raise SlotHasActiveBookings()

        try:
            result = await conn.execute(
                text("DELETE FROM time_slots WHERE id = :slot_id RETURNING id"),
                {"slot_id": slot_id},
            )
        except Exception as err:
            # Backstop: if the constraint ever changes to allow the delete
            # path this guard models, a stray FK violation must surface as
            # the same 409, never a bare 500.
            if is_foreign_key_violation(err):
                raise SlotHasActiveBookings() from err
            raise
        deleted = result.first()
        if deleted is None:
            return None
        # psycopg hands back a UUID object; the caller compares against
        # the canonical string it passed in.
        return str(deleted[0])
