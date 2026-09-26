"""Server-side reads, writes and DTO mapping for services. Every write
is owner-scoped: organizer_id sits in the WHERE clause rather than
being checked by a preceding SELECT, so a foreign id matches no row and
there is no read-then-write gap to exploit.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from ..demo import refuse_demo_write
from .client import engine
from .errors import NoServiceUpdatesError, ServiceHasBookingsError
from .rows import SERVICE_COLUMNS, ServiceRow, scan_service
from .shared import is_foreign_key_violation, new_service_id


def _root(value: Any) -> Any:
    while hasattr(value, "root"):
        value = value.root
    return value


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


async def create_service(organizer_id: str, input: Any) -> ServiceRow | None:
    """The owner always comes from the session, never the payload;
    optional columns are normalized to null."""
    refuse_demo_write(organizer_id)
    mode = None
    if input.optionsSelectMode is not None:
        mode = str(_root(input.optionsSelectMode))
    options = None
    if input.options is not None:
        options = [_root(o) for o in _root(input.options)]
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
                "title": str(_root(input.title)),
                "description": _root(input.description),
                "photo": _root(input.photoUrl),
                "location": _root(input.location),
                "contact": _root(input.contact),
                "price": str(_root(input.defaultPrice)),
                "capacity": int(_root(input.defaultCapacity)),
                "duration": int(_root(input.defaultDurationMinutes)),
                "max_seats": int(_root(input.maxSeatsPerBooking)),
                "options": options,
                "mode": mode,
            },
        )
        return scan_service(result.first())


async def update_owned_service_tx(
    conn: AsyncConnection, organizer_id: str, service_id: str, update: Any
) -> ServiceRow | None:
    """None when the id does not exist or belongs to someone else
    (caller answers 404 either way); NoServiceUpdatesError when the
    payload carries no writable field. Paired with get_owned_service_tx
    on one merge-patch transaction.

    Defense in depth: routes already refuse the demo account via
    require_writable_organizer — a direct db call must not write it
    either."""
    refuse_demo_write(organizer_id)
    sets: list[str] = []
    args: dict[str, Any] = {"sid": service_id, "org_id": organizer_id}

    def add(col: str, key: str, value: Any) -> None:
        sets.append(f"{col} = :{key}")
        args[key] = value

    def set_null(col: str) -> None:
        sets.append(f"{col} = NULL")

    state = update.state
    touched = update.touched
    if touched.get("title") and state.title is not None:
        add("title", "title", str(_root(state.title)))
    if touched.get("description"):
        if state.description is not None:
            add("description", "description", str(_root(state.description)))
        else:
            set_null("description")
    if touched.get("location"):
        if state.location is not None:
            add("location", "location", str(_root(state.location)))
        else:
            set_null("location")
    if touched.get("contact"):
        if state.contact is not None:
            add("contact", "contact", str(_root(state.contact)))
        else:
            set_null("contact")
    if touched.get("defaultPrice") and state.defaultPrice is not None:
        add("default_price", "default_price", str(_root(state.defaultPrice)))
    if touched.get("defaultCapacity") and state.defaultCapacity is not None:
        add("default_capacity", "default_capacity", int(_root(state.defaultCapacity)))
    if touched.get("defaultDurationMinutes") and state.defaultDurationMinutes is not None:
        add("default_duration_minutes", "duration", int(_root(state.defaultDurationMinutes)))
    if touched.get("maxSeatsPerBooking") and state.maxSeatsPerBooking is not None:
        add("max_seats_per_booking", "max_seats", int(_root(state.maxSeatsPerBooking)))
    if touched.get("options"):
        if state.options is not None:
            add("options", "options", [_root(o) for o in _root(state.options)])
        else:
            set_null("options")
    if touched.get("optionsSelectMode"):
        if state.optionsSelectMode is not None:
            sets.append("options_select_mode = CAST(:mode AS options_select_mode)")
            args["mode"] = str(_root(state.optionsSelectMode))
        else:
            set_null("options_select_mode")
    if touched.get("photoUrl"):
        if state.photoUrl is not None:
            add("photo_url", "photo_url", str(state.photoUrl))
        else:
            set_null("photo_url")
    if not sets:
        raise NoServiceUpdatesError()

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
            raise ServiceHasBookingsError()

        try:
            result = await conn.execute(
                text("DELETE FROM services WHERE id = :sid RETURNING photo_url"),
                {"sid": service_id},
            )
        except Exception as err:
            # Backstop: a stray FK violation must surface as the same
            # 409, never a bare 500.
            if is_foreign_key_violation(err):
                raise ServiceHasBookingsError() from err
            raise
        deleted = result.first()
        if deleted is None:
            return None
        # psycopg hands back a UUID object; the caller compares and
        # interpolates the canonical string.
        return str(service_id), deleted[0]
