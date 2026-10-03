"""Service service — the cabinet's service CRUD.

Every write is owner-scoped: organizer_id sits in the WHERE clause
rather than being checked by a preceding SELECT, so a foreign id matches
no row and there is no read-then-write gap to exploit.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..contracts import models_gen as gen
from ..db.rows import ServiceRow, from_model_service
from ..db.shared import TouchedUpdate, is_foreign_key_violation, new_service_id
from ..demo import refuse_demo_write
from ..errors import NothingToUpdate, PhotoPrefix, ServiceHasBookings
from ..repositories import service_repo


async def list_services(session: AsyncSession, organizer_id: str) -> list[ServiceRow]:
    """All services of an organizer, oldest first."""
    async with session.begin():
        models = await service_repo.list_by_organizer(session, organizer_id)
    return [from_model_service(m) for m in models]


async def get_owned_service(
    session: AsyncSession, organizer_id: str, service_id: str
) -> ServiceRow | None:
    """None when the id does not exist *or* belongs to someone else —
    no leaking a foreign service by guessing ids. Ownership sits in the
    WHERE clause like every sibling query."""
    async with session.begin():
        return await get_owned_service_tx(session, organizer_id, service_id)


async def get_owned_service_tx(
    session: AsyncSession, organizer_id: str, service_id: str
) -> ServiceRow | None:
    """The caller's-transaction variant — the merge-patch skeleton reads
    and writes on one tx."""
    model = await service_repo.get_owned_service(session, organizer_id, service_id)
    return from_model_service(model) if model is not None else None


async def create_service(
    session: AsyncSession, organizer_id: str, payload: gen.CreateServiceInput
) -> ServiceRow | None:
    """Owner comes from the session, never the payload. The
    media-ownership invariant lives here — photoUrl must stay under
    this organizer's media prefix, checked before the INSERT."""
    refuse_demo_write(organizer_id)
    if payload.photoUrl is not None:
        if not storage.is_own_media_url(organizer_id, str(payload.photoUrl)):
            raise PhotoPrefix()
    mode: Any = None
    if payload.optionsSelectMode is not None:
        mode = str(payload.optionsSelectMode)
    options = None
    if payload.options is not None:
        options = [o for o in payload.options]
    async with session.begin():
        model = await service_repo.create_service(
            session,
            {
                "id": new_service_id(),
                "organizer_id": organizer_id,
                "title": str(payload.title),
                "description": payload.description,
                "photo_url": payload.photoUrl,
                "location": payload.location,
                "contact": payload.contact,
                "default_price": str(payload.defaultPrice),
                "default_capacity": int(payload.defaultCapacity),
                "default_duration_minutes": int(payload.defaultDurationMinutes),
                "max_seats_per_booking": int(payload.maxSeatsPerBooking),
                "options": options,
                "options_select_mode": mode,
            },
        )
    return from_model_service(model)


async def update_owned_service_tx(
    session: AsyncSession,
    organizer_id: str,
    service_id: str,
    update: TouchedUpdate[gen.UpdateServiceInput],
) -> ServiceRow | None:
    """None when the id does not exist or belongs to someone else
    (caller answers 404); NothingToUpdate when the payload carries no
    writable field. Paired with get_owned_service_tx on one merge-patch
    transaction.

    Defense in depth: routes already refuse the demo account, but a
    direct service call must not write it either. The media-ownership
    invariant lives here too — a touched photoUrl must stay under this
    organizer's media prefix, checked in the tx before any write."""
    refuse_demo_write(organizer_id)
    state = update.state
    touched = update.touched
    if touched.get("photoUrl") and state.photoUrl is not None:
        if not storage.is_own_media_url(organizer_id, str(state.photoUrl)):
            raise PhotoPrefix()
    # Column-keyed touched values: absent keys untouched, explicit
    # nulls clear the column (merge-patch, ADR-016). Core update(), not
    # f-string SET.
    values: dict[str, Any] = {}
    if touched.get("title") and state.title is not None:
        values["title"] = str(state.title)
    if touched.get("description"):
        values["description"] = str(state.description) if state.description is not None else None
    if touched.get("location"):
        values["location"] = str(state.location) if state.location is not None else None
    if touched.get("contact"):
        values["contact"] = str(state.contact) if state.contact is not None else None
    if touched.get("defaultPrice") and state.defaultPrice is not None:
        values["default_price"] = str(state.defaultPrice)
    if touched.get("defaultCapacity") and state.defaultCapacity is not None:
        values["default_capacity"] = int(state.defaultCapacity)
    if touched.get("defaultDurationMinutes") and state.defaultDurationMinutes is not None:
        values["default_duration_minutes"] = int(state.defaultDurationMinutes)
    if touched.get("maxSeatsPerBooking") and state.maxSeatsPerBooking is not None:
        values["max_seats_per_booking"] = int(state.maxSeatsPerBooking)
    if touched.get("options"):
        values["options"] = [o for o in state.options] if state.options is not None else None
    if touched.get("optionsSelectMode"):
        values["options_select_mode"] = (
            str(state.optionsSelectMode) if state.optionsSelectMode is not None else None
        )
    if touched.get("photoUrl"):
        values["photo_url"] = str(state.photoUrl) if state.photoUrl is not None else None
    if not values:
        raise NothingToUpdate()

    model = await service_repo.update_service_merge_patch(session, organizer_id, service_id, values)
    return from_model_service(model) if model is not None else None


async def delete_owned_service(
    session: AsyncSession, organizer_id: str, service_id: str
) -> tuple[str, str | None] | None:
    """Refuse to delete a service whose slots are referenced by any
    booking row. Slots cascade on the services FK, but bookings hold
    slots with ON DELETE RESTRICT — the cascade stops at the first
    booked slot and the raw FK error would surface as a 500. The guard
    answers a 409; the FK mapping below is the backstop. None when
    nothing matched. The deleted cover URL rides along so the caller
    removes the R2 object after the commit — a separate read-then-delete
    would race a concurrent PATCH pointing the row at a new cover."""
    refuse_demo_write(organizer_id)
    async with session.begin():
        # Lock the service row for a stable parent. FOR UPDATE
        # serializes against a service delete, not a booking INSERT
        # (bookings lock the slot row) — a booking landing between the
        # guard and the DELETE is caught by the FK backstop below.
        locked = await service_repo.get_owned_service_for_update(session, organizer_id, service_id)
        if locked is None:
            return None
        scoped_id = str(locked.id)

        if await service_repo.count_bookings_for_service(session, scoped_id) > 0:
            raise ServiceHasBookings()

        try:
            deleted = await service_repo.delete_owned_service(session, organizer_id, scoped_id)
        except Exception as err:
            # Backstop: a stray FK violation surfaces as the same 409,
            # never a bare 500.
            if is_foreign_key_violation(err):
                raise ServiceHasBookings() from err
            raise
        if deleted is None:
            return None
        # psycopg hands back a UUID object; the caller interpolates the
        # canonical string.
        return scoped_id, deleted.photo_url
