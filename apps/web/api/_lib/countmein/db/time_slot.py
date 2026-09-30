"""Server-side reads, writes and DTO mapping for time slots. Ownership
is transitive: a slot belongs to a service, the service to an organizer
(invariant 5), so every statement scopes through the parent service with
an owned-services subquery in the WHERE clause.

Naming: this module is `time_slot.py`, not `slot.py`, deliberately —
it mirrors the Postgres table `time_slots` (the SQL text below speaks
about that table on every line), while the route layer keeps the REST
plural (`routes/slots.py`) and the validation layer the wire schema's
singular (`validation/decode/slot.py`). The fragmentation is documented
intent, not drift.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..contracts import domain
from ..contracts import models_gen as gen
from ..demo import refuse_demo_write
from ..errors import CapacityBelowBooked, NothingToUpdate, SlotHasActiveBookings
from ..repositories import service_repo, slot_repo
from .client import sessionmaker
from .rows import TimeSlotRow, from_model_slot
from .shared import TouchedUpdate, is_foreign_key_violation, new_id


def _slot_starts_at_time(s: Any) -> Any:
    """Extract the instant behind the generated oneOf wrapper (ISO string
    or epoch)."""
    return domain.parse_flex_time(s)


async def list_slots(organizer_id: str, upcoming_only: bool) -> list[TimeSlotRow]:
    """Every slot across an organizer's services, earliest first.
    upcoming_only drops slots that have already started (the cabinet list
    is a schedule, past sessions are noise there).

    Bounded: a schedule years deep must not stream unbounded rows into
    one response. The cabinet paginates client-side today; the cap is
    the server-side backstop."""
    async with sessionmaker()() as session:
        models = await slot_repo.list_by_organizer(session, organizer_id, upcoming_only)
        return [from_model_slot(m) for m in models]


async def get_owned_slot(organizer_id: str, slot_id: str) -> TimeSlotRow | None:
    """None when the id does not exist *or* hangs off another
    organizer's service, so callers cannot leak a foreign slot by
    guessing ids."""
    async with sessionmaker()() as session:
        return await get_owned_slot_tx(session, organizer_id, slot_id)


async def get_owned_slot_tx(
    session: AsyncSession, organizer_id: str, slot_id: str
) -> TimeSlotRow | None:
    model = await slot_repo.get_owned_slot(session, organizer_id, slot_id)
    return from_model_slot(model) if model is not None else None


async def create_slot(organizer_id: str, payload: gen.CreateTimeSlotInput) -> TimeSlotRow | None:
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
    async with sessionmaker()() as session, session.begin():
        owned = await service_repo.get_owned_service(session, organizer_id, str(payload.serviceId))
        if owned is None:
            return None

        starts_at = _slot_starts_at_time(payload.startsAt)
        try:
            model = await slot_repo.create_slot(
                session,
                {
                    "id": new_id(),
                    "service_id": str(owned.id),
                    "starts_at": starts_at,
                    "duration_minutes": int(payload.durationMinutes),
                    "capacity": int(payload.capacity),
                    "price": payload.price,
                },
            )
        except Exception as err:
            # The ownership check and the INSERT are not one snapshot: a
            # service deleted in between surfaces as 23503, which must read
            # as "not found", never a bare 500.
            if is_foreign_key_violation(err):
                return None
            raise
        return from_model_slot(model)


async def update_owned_slot_tx(
    session: AsyncSession,
    organizer_id: str,
    slot_id: str,
    update: TouchedUpdate[gen.UpdateTimeSlotInput],
) -> TimeSlotRow | None:
    """booked_count is deliberately not updatable: seats move only
    through the atomic reserve in the booking flow (invariant 2).
    Shrinking capacity below the seats already sold answers a 409. Runs
    on a caller-supplied transaction: the merge-patch route opens the
    tx, reads the current state, merges, and calls this on the same tx —
    the capacity precheck's FOR UPDATE lock then also serializes
    against concurrent merge-patch reads of the same row."""
    refuse_demo_write(organizer_id)
    state = update.state
    touched = update.touched
    # Column-keyed touched values: Core update() instead of f-string SET
    # concatenation.
    values: dict[str, Any] = {}
    if touched.get("startsAt") and state.startsAt is not None:
        values["starts_at"] = _slot_starts_at_time(state.startsAt)
    if touched.get("durationMinutes") and state.durationMinutes is not None:
        values["duration_minutes"] = int(state.durationMinutes)
    if touched.get("capacity") and state.capacity is not None:
        values["capacity"] = int(state.capacity)
    if touched.get("price"):
        values["price"] = str(state.price) if state.price is not None else None
    if not values:
        raise NothingToUpdate()

    # Capacity precheck under a row lock: a plain SELECT takes no lock
    # under READ COMMITTED, so the check could race the booking flow's
    # atomic reserve. FOR UPDATE serializes against it (the TS backstop
    # was the booked_count CHECK constraint surfacing as an opaque 23514).
    if touched.get("capacity") and state.capacity is not None:
        booked = await slot_repo.get_booked_count_for_update(session, organizer_id, slot_id)
        if booked is None:
            return None
        if state.capacity < booked:
            raise CapacityBelowBooked(booked_count=booked)

    model = await slot_repo.update_slot_merge_patch(session, organizer_id, slot_id, values)
    return from_model_slot(model) if model is not None else None


async def delete_owned_slot(organizer_id: str, slot_id: str) -> str | None:
    """Refuse to delete a slot that is referenced by any booking row,
    confirmed or cancelled (the time_slots FK is ON DELETE RESTRICT, so
    the database would reject the delete anyway; failing here turns the
    opaque FK error into a 409 the organizer can act on). The guard must
    be at least as wide as the constraint: counting only confirmed
    bookings would let a cancelled-only slot fall through to a raw 23503
    and a bare 500. Returns None when nothing matched."""
    refuse_demo_write(organizer_id)
    async with sessionmaker()() as session, session.begin():
        # Lock the slot row so the check and delete are atomic against
        # the booking flow's reserve (a plain SELECT takes no lock under
        # READ COMMITTED).
        locked = await slot_repo.get_owned_slot_for_update(session, organizer_id, slot_id)
        if locked is None:
            return None
        scoped_id = str(locked.id)

        if await slot_repo.count_bookings_for_slot(session, scoped_id) > 0:
            raise SlotHasActiveBookings()

        try:
            deleted = await slot_repo.delete_slot(session, organizer_id, scoped_id)
        except Exception as err:
            # Backstop: if the constraint ever changes to allow the delete
            # path this guard models, a stray FK violation must surface as
            # the same 409, never a bare 500.
            if is_foreign_key_violation(err):
                raise SlotHasActiveBookings() from err
            raise
        if deleted is None:
            return None
        return deleted
