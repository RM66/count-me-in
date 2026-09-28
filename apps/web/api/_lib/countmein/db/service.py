"""Server-side reads, writes and DTO mapping for services. Every write
is owner-scoped: organizer_id sits in the WHERE clause rather than
being checked by a preceding SELECT, so a foreign id matches no row and
there is no read-then-write gap to exploit.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from .. import storage
from ..contracts import models_gen as gen
from ..demo import refuse_demo_write
from ..errors import NothingToUpdate, PhotoPrefix, ServiceHasBookings
from .client import engine
from .rows import SERVICE_COLUMNS, ServiceRow, scan_service
from .shared import TouchedUpdate, is_foreign_key_violation, new_service_id


async def list_services(organizer_id: str) -> list[ServiceRow]:
    """All services of an organizer, oldest first."""
    async with engine().connect() as conn:
        result = await conn.execute(
            text(
                f"SELECT {SERVICE_COLUMNS} FROM services "
                "WHERE organizer_id = :org_id ORDER BY created_at ASC LIMIT 200"
            ),
            {"org_id": organizer_id},
        )
        return [s for s in (scan_service(r) for r in result) if s is not None]


async def get_owned_service(organizer_id: str, service_id: str) -> ServiceRow | None:
    """None when the id does not exist *or* belongs to someone else, so
    callers cannot leak another organizer's service by guessing ids.
    Ownership sits in the WHERE clause like every sibling query."""
    async with engine().connect() as conn:
        return await get_owned_service_tx(conn, organizer_id, service_id)


async def get_owned_service_tx(
    conn: AsyncConnection, organizer_id: str, service_id: str
) -> ServiceRow | None:
    result = await conn.execute(
        text(
            f"SELECT {SERVICE_COLUMNS} FROM services "
            "WHERE id = :sid AND organizer_id = :org_id LIMIT 1"
        ),
        {"sid": service_id, "org_id": organizer_id},
    )
    return scan_service(result.first())


async def create_service(organizer_id: str, payload: gen.CreateServiceInput) -> ServiceRow | None:
    """The owner always comes from the session, never the payload;
    optional columns are normalized to null. The media-ownership
    invariant lives here — a photoUrl must stay under this organizer's
    media prefix, checked before the INSERT."""
    refuse_demo_write(organizer_id)
    if payload.photoUrl is not None:
        if not storage.is_own_media_url(organizer_id, str(payload.photoUrl)):
            raise PhotoPrefix()
    mode = None
    if payload.optionsSelectMode is not None:
        mode = str(payload.optionsSelectMode)
    options = None
    if payload.options is not None:
        options = [o for o in payload.options]
    async with engine().begin() as conn:
        result = await conn.execute(
            text(
                f"""
                INSERT INTO services (id, organizer_id, title, description, photo_url, location, contact,
                    default_price, default_capacity, default_duration_minutes, max_seats_per_booking,
                    options, options_select_mode)
                VALUES (:id, :org_id, :title, :description, :photo, :location, :contact,
                    :price, :capacity, :duration, :max_seats, :options, CAST(:mode AS options_select_mode))
                RETURNING {SERVICE_COLUMNS}
                """
            ),
            {
                "id": new_service_id(),
                "org_id": organizer_id,
                "title": str(payload.title),
                "description": payload.description,
                "photo": payload.photoUrl,
                "location": payload.location,
                "contact": payload.contact,
                "price": str(payload.defaultPrice),
                "capacity": int(payload.defaultCapacity),
                "duration": int(payload.defaultDurationMinutes),
                "max_seats": int(payload.maxSeatsPerBooking),
                "options": options,
                "mode": mode,
            },
        )
        return scan_service(result.first())


async def update_owned_service_tx(
    conn: AsyncConnection,
    organizer_id: str,
    service_id: str,
    update: TouchedUpdate[gen.UpdateServiceInput],
) -> ServiceRow | None:
    """None when the id does not exist or belongs to someone else
    (caller answers 404 either way); NothingToUpdate when the
    payload carries no writable field. Paired with get_owned_service_tx
    on one merge-patch transaction.

    Defense in depth: routes already refuse the demo account via
    require_writable_organizer — a direct db call must not write it
    either. The media-ownership invariant lives here too — a touched
    photoUrl must stay under this organizer's media prefix, checked
    inside the transaction before any column is written."""
    refuse_demo_write(organizer_id)
    state = update.state
    touched = update.touched
    if touched.get("photoUrl") and state.photoUrl is not None:
        if not storage.is_own_media_url(organizer_id, str(state.photoUrl)):
            raise PhotoPrefix()
    sets: list[str] = []
    args: dict[str, Any] = {"sid": service_id, "org_id": organizer_id}

    def add(col: str, key: str, value: Any) -> None:
        sets.append(f"{col} = :{key}")
        args[key] = value

    def set_null(col: str) -> None:
        sets.append(f"{col} = NULL")

    if touched.get("title") and state.title is not None:
        add("title", "title", str(state.title))
    if touched.get("description"):
        if state.description is not None:
            add("description", "description", str(state.description))
        else:
            set_null("description")
    if touched.get("location"):
        if state.location is not None:
            add("location", "location", str(state.location))
        else:
            set_null("location")
    if touched.get("contact"):
        if state.contact is not None:
            add("contact", "contact", str(state.contact))
        else:
            set_null("contact")
    if touched.get("defaultPrice") and state.defaultPrice is not None:
        add("default_price", "default_price", str(state.defaultPrice))
    if touched.get("defaultCapacity") and state.defaultCapacity is not None:
        add("default_capacity", "default_capacity", int(state.defaultCapacity))
    if touched.get("defaultDurationMinutes") and state.defaultDurationMinutes is not None:
        add("default_duration_minutes", "duration", int(state.defaultDurationMinutes))
    if touched.get("maxSeatsPerBooking") and state.maxSeatsPerBooking is not None:
        add("max_seats_per_booking", "max_seats", int(state.maxSeatsPerBooking))
    if touched.get("options"):
        if state.options is not None:
            add("options", "options", [o for o in state.options])
        else:
            set_null("options")
    if touched.get("optionsSelectMode"):
        if state.optionsSelectMode is not None:
            sets.append("options_select_mode = CAST(:mode AS options_select_mode)")
            args["mode"] = str(state.optionsSelectMode)
        else:
            set_null("options_select_mode")
    if touched.get("photoUrl"):
        if state.photoUrl is not None:
            add("photo_url", "photo_url", str(state.photoUrl))
        else:
            set_null("photo_url")
    if not sets:
        raise NothingToUpdate()

    query = (
        f"UPDATE services SET {', '.join(sets)} "
        f"WHERE id = :sid AND organizer_id = :org_id RETURNING {SERVICE_COLUMNS}"
    )
    result = await conn.execute(text(query), args)
    return scan_service(result.first())


async def delete_owned_service(organizer_id: str, service_id: str) -> tuple[str, str | None] | None:
    """Refuse to delete a service whose slots are referenced by any
    booking row. Slots cascade on the services FK, but bookings hold
    their slots with ON DELETE RESTRICT, so the cascade stops at the
    first booked slot and the raw FK error would surface as a 500. The
    guard runs first and answers a 409 the organizer can act on; the
    FK mapping below is the backstop. Returns None when nothing matched.
    The deleted cover URL rides along so the caller can remove the R2
    object best-effort after the commit (same pattern as the PUT
    handlers) — a separate read-then-delete would race with a
    concurrent PUT pointing the row at a new cover."""
    refuse_demo_write(organizer_id)
    async with engine().begin() as conn:
        # Lock the service row so the check sees a stable parent: FOR
        # UPDATE serializes against a concurrent service delete, not
        # against a concurrent booking INSERT (bookings lock the slot
        # row, not the service row). A booking landing between the guard
        # and the DELETE is caught by the FK backstop below, which
        # answers the same 409.
        result = await conn.execute(
            text("SELECT id FROM services WHERE id = :sid AND organizer_id = :org_id FOR UPDATE"),
            {"sid": service_id, "org_id": organizer_id},
        )
        row = result.first()
        if row is None:
            return None
        service_id = row[0]

        result = await conn.execute(
            text(
                "SELECT count(*) FROM bookings b "
                "INNER JOIN time_slots ts ON b.time_slot_id = ts.id "
                "WHERE ts.service_id = :sid"
            ),
            {"sid": service_id},
        )
        if result.scalar_one() > 0:
            raise ServiceHasBookings()

        try:
            result = await conn.execute(
                text("DELETE FROM services WHERE id = :sid RETURNING photo_url"),
                {"sid": service_id},
            )
        except Exception as err:
            # Backstop: a stray FK violation must surface as the same
            # 409, never a bare 500.
            if is_foreign_key_violation(err):
                raise ServiceHasBookings() from err
            raise
        deleted = result.first()
        if deleted is None:
            return None
        # psycopg hands back a UUID object; the caller compares and
        # interpolates the canonical string.
        return str(service_id), deleted[0]
