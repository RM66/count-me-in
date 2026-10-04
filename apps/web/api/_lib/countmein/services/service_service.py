"""Service service — the cabinet's service writes.

Every write is owner-scoped: organizer_id sits in the WHERE clause
rather than being checked by a preceding SELECT, so a foreign id matches
no row and there is no read-then-write gap to exploit. Reads with no
business rule live in service_repo — routes call it directly.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..contracts import models_gen as gen
from ..db.shared import is_foreign_key_violation, new_service_id
from ..demo import refuse_demo_write
from ..errors import PhotoPrefix, ServiceHasBookings
from ..models.service import Service
from ..repositories import service_repo


async def create_service(
    session: AsyncSession, organizer_id: str, payload: gen.CreateServiceInput
) -> Service:
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
        return await service_repo.create_service(
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


async def update_owned_service(
    session: AsyncSession,
    organizer_id: str,
    service_id: str,
    values: dict[str, Any],
) -> Service | None:
    """Merge-patch write of already column-keyed values (absent keys
    untouched, explicit nulls cleared by the caller — ADR-016). None
    when the id does not exist or belongs to someone else (caller
    answers 404). Runs on the caller's transaction.

    Defense in depth: routes already refuse the demo account, but a
    direct service call must not write it either. The media-ownership
    invariant lives here too — a touched photoUrl must stay under this
    organizer's media prefix, checked in the tx before any write."""
    refuse_demo_write(organizer_id)
    photo_url = values.get("photo_url")
    if photo_url is not None and not storage.is_own_media_url(organizer_id, str(photo_url)):
        raise PhotoPrefix()
    return await service_repo.update_service_merge_patch(session, organizer_id, service_id, values)


async def delete_owned_service(
    session: AsyncSession, organizer_id: str, service_id: str
) -> Service | None:
    """Refuse to delete a service whose slots are referenced by any
    booking row. Slots cascade on the services FK, but bookings hold
    slots with ON DELETE RESTRICT — the cascade stops at the first
    booked slot and the raw FK error would surface as a 500. The guard
    answers a 409; the FK mapping below is the backstop. None when
    nothing matched. The deleted row comes back so the caller removes
    the R2 object behind photo_url after the commit — a separate
    read-then-delete would race a concurrent PATCH pointing the row at
    a new cover."""
    refuse_demo_write(organizer_id)
    async with session.begin():
        # Lock the service row for a stable parent. FOR UPDATE
        # serializes against a service delete, not a booking INSERT
        # (bookings lock the slot row) — a booking landing between the
        # guard and the DELETE is caught by the FK backstop below.
        locked = await service_repo.get_owned_service_for_update(session, organizer_id, service_id)
        if locked is None:
            return None

        if await service_repo.count_bookings_for_service(session, locked.id) > 0:
            raise ServiceHasBookings()

        try:
            deleted = await service_repo.delete_owned_service(session, organizer_id, locked.id)
        except IntegrityError as err:
            # Backstop: a stray FK violation surfaces as the same 409,
            # never a bare 500.
            if is_foreign_key_violation(err):
                raise ServiceHasBookings() from err
            raise
        return deleted
