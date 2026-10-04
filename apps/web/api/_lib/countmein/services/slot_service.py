"""Time-slot service — the cabinet's slot writes.

Ownership is transitive: a slot belongs to a service, the service to an
organizer (invariant 5), so every statement scopes through the parent
service with an owned-services subquery in the WHERE clause. Reads with
no business rule live in slot_repo — routes call it directly.

Named slot_service (the repository mirrors the `time_slots` table); the
route layer keeps the REST plural (routes/slots.py).
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..contracts import domain
from ..contracts import models_gen as gen
from ..db.shared import is_foreign_key_violation, new_id
from ..demo import refuse_demo_write
from ..errors import CapacityBelowBooked, SlotHasActiveBookings
from ..models.time_slot import TimeSlot
from ..repositories import service_repo, slot_repo

# The rolling horizon for public upcoming-slot reads (ADR-023 Phase 2):
# a years-deep schedule must not grow one public payload unboundedly.
# Public routes apply it with `starts_at >= now` and the row limit;
# slots past it stay in the DB, just unlisted. The cabinet's list is
# unbounded — the organizer must see every authored slot.
SLOT_HORIZON = timedelta(days=90)


async def create_slot(
    session: AsyncSession, organizer_id: str, payload: gen.CreateTimeSlotInput
) -> TimeSlot | None:
    """Under a service owned by organizer_id; None when the parent is
    missing or foreign (caller answers 404 without confirming a foreign
    id). Ownership is a SELECT before the insert (the id is generated
    app-side, so no INSERT…SELECT; the gap is harmless — a service
    deleted in between is caught by the FK)."""
    refuse_demo_write(organizer_id)
    async with session.begin():
        owned = await service_repo.get_owned_service(session, organizer_id, str(payload.serviceId))
        if owned is None:
            return None

        try:
            return await slot_repo.create_slot(
                session,
                {
                    "id": new_id(),
                    "service_id": str(owned.id),
                    "starts_at": domain.parse_flex_time(payload.startsAt),
                    "duration_minutes": int(payload.durationMinutes),
                    "capacity": int(payload.capacity),
                    "price": payload.price,
                },
            )
        except IntegrityError as err:
            # Check and INSERT are not one snapshot: a service deleted
            # in between surfaces as 23503 — "not found", never a 500.
            if is_foreign_key_violation(err):
                return None
            raise


async def update_owned_slot(
    session: AsyncSession,
    organizer_id: str,
    slot_id: str,
    current: TimeSlot,
    values: dict[str, Any],
) -> TimeSlot | None:
    """Merge-patch write of already column-keyed values (absent keys
    untouched, explicit nulls cleared — ADR-016), on the caller's
    transaction. `current` is the same row read under FOR UPDATE by the
    merge-patch fetch — shrinking capacity is checked against its
    booked_count, which the lock keeps stable against the atomic
    reserve. booked_count itself is never updatable: seats move only
    through the atomic reserve (invariant 2)."""
    refuse_demo_write(organizer_id)
    if "capacity" in values and values["capacity"] < current.booked_count:
        raise CapacityBelowBooked(booked_count=current.booked_count)
    return await slot_repo.update_slot_merge_patch(session, organizer_id, slot_id, values)


async def delete_owned_slot(
    session: AsyncSession, organizer_id: str, slot_id: str
) -> TimeSlot | None:
    """Refuse to delete a slot referenced by any booking row, confirmed
    or cancelled — the FK is ON DELETE RESTRICT, so failing here turns
    an opaque FK error into a 409. The guard must be at least as wide as
    the constraint: counting only confirmed bookings would drop a
    cancelled-only slot to a raw 23503 → bare 500. None when nothing
    matched; the deleted row's snapshot comes back so the caller derives
    cache tags without a second read."""
    refuse_demo_write(organizer_id)
    async with session.begin():
        # Lock the slot row so check + delete are atomic against the
        # booking reserve (a plain SELECT takes no lock under READ
        # COMMITTED).
        locked = await slot_repo.get_owned_slot_for_update(session, organizer_id, slot_id)
        if locked is None:
            return None

        if await slot_repo.count_bookings_for_slot(session, locked.id) > 0:
            raise SlotHasActiveBookings()

        try:
            deleted = await slot_repo.delete_slot(session, organizer_id, locked.id)
        except IntegrityError as err:
            # Backstop: a stray FK violation surfaces as the same 409,
            # never a bare 500.
            if is_foreign_key_violation(err):
                raise SlotHasActiveBookings() from err
            raise
        if deleted is None:
            return None
        return locked
