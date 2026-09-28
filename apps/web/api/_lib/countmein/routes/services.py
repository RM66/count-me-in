"""Service routes: the cabinet's service CRUD.

The handlers lean on the exception hierarchy: guards and
decoders raise, the db layer raises ApiError subclasses, and the
app-level handler renders them. The shared preamble is a set
of FastAPI dependencies (web/deps.py) declared in the handler
signature. The merge-patch PUT runs through the shared transactional
skeleton (routes/mergepatch.apply_merge_patch); the media-ownership
invariant is enforced inside the db write (db/service.py).
"""

from __future__ import annotations

from typing import Any

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine
from starlette.background import BackgroundTask
from starlette.requests import Request
from starlette.responses import Response as StarletteResponse

from ..contracts import models_gen as gen
from ..db.rows import ServiceRow, to_service_record
from ..db.service import (
    create_service,
    delete_owned_service,
    get_owned_service,
    get_owned_service_tx,
    list_services,
    update_owned_service_tx,
)
from ..errors import (
    CannotCreateService,
    ServiceNotFound,
)
from ..validation.decode import (
    decode_create_service_input,
    decode_merged_service_input,
    decode_update_service_input,
)
from ..web import json_response
from ..web.deps import (
    ValidatedBody,
    cabinet_organizer,
    decoded,
    get_db_engine,
    merge_patch_content_type,
)
from ..web.guards import require_writable_organizer
from .media import cleanup_replaced_media
from .mergepatch import apply_merge_patch, touched_update


def service_writable_state(s: ServiceRow) -> dict[str, Any]:
    """The writable fields of a service row in their wire shape — the
    merge-patch base."""
    return {
        "title": s.title,
        "description": s.description,
        "location": s.location,
        "contact": s.contact,
        "defaultPrice": s.default_price,
        "defaultCapacity": s.default_capacity,
        "defaultDurationMinutes": s.default_duration_minutes,
        "maxSeatsPerBooking": s.max_seats_per_booking,
        "options": s.options,
        "optionsSelectMode": s.options_select_mode,
        "photoUrl": s.photo_url,
    }


async def _fetch_owned(conn: AsyncConnection, organizer_id: str, service_id: str) -> ServiceRow:
    row = await get_owned_service_tx(conn, organizer_id, service_id)
    if row is None:
        raise ServiceNotFound()
    return row


async def _update_owned(
    conn: AsyncConnection,
    organizer_id: str,
    service_id: str,
    update: Any,
) -> ServiceRow:
    row = await update_owned_service_tx(conn, organizer_id, service_id, update)
    if row is None:
        raise ServiceNotFound()
    return row


async def services_list(
    request: Request,
    scope: tuple[str, bool] = Depends(cabinet_organizer),
) -> StarletteResponse:
    """GET /api/services: lists the services of the organizer this
    request may view (the signed-in organizer, or the demo organizer for
    anonymous visitors, ADR-010)."""
    organizer_id, _ = scope

    rows = await list_services(organizer_id)
    services = [to_service_record(row) for row in rows]
    return json_response(200, gen.ServicesEnvelope(services=services)).to_starlette()


_create_service_dep = decoded(decode_create_service_input)


async def services_create(
    request: Request,
    organizer_id: str = Depends(require_writable_organizer),
    body: ValidatedBody[gen.CreateServiceInput] = Depends(_create_service_dep),
) -> StarletteResponse:
    """POST /api/services: creates a service owned by the signed-in
    organizer — organizerId always comes from the session, never from
    the body. The cover-URL ownership check runs inside the db write
    (db/service.create_service)."""
    row = await create_service(organizer_id, body.model)
    if row is None:
        # Structurally unreachable (INSERT … RETURNING either errors or
        # returns the row) — kept as defensive parity with the TS check,
        # where drizzle's .returning() could yield an empty array.
        raise CannotCreateService()

    return json_response(201, gen.ServiceEnvelope(service=to_service_record(row))).to_starlette()


async def service_get(
    request: Request,
    id: str,
    scope: tuple[str, bool] = Depends(cabinet_organizer),
) -> StarletteResponse:
    """GET /api/services/{id}, scoped to the organizer this request may
    view: an id belonging to someone else answers 404, not 403, so the
    endpoint never confirms that a foreign id exists."""
    organizer_id, _ = scope

    row = await get_owned_service(organizer_id, id)
    if row is None:
        raise ServiceNotFound()
    return json_response(200, gen.ServiceEnvelope(service=to_service_record(row))).to_starlette()


_update_service_dep = decoded(decode_update_service_input)


async def service_put(
    request: Request,
    id: str,
    organizer_id: str = Depends(require_writable_organizer),
    _ct: None = Depends(merge_patch_content_type),
    body: ValidatedBody[gen.UpdateServiceInput] = Depends(_update_service_dep),
    db_engine: AsyncEngine = Depends(get_db_engine),
) -> StarletteResponse:
    """PUT /api/services/{id}. Takes a JSON Merge Patch body (absent key
    = keep, explicit null = clear, RFC 7386/ADR-016): the patch is
    validated first (a null on a non-nullable key is rejected before any
    read), then merged into the current state and the result
    re-validated."""
    row, current, touched = await apply_merge_patch(
        db_engine,
        body.raw,
        fetch=lambda conn: _fetch_owned(conn, organizer_id, id),
        writable_state=service_writable_state,
        decode_merged=lambda merged, _touched: decode_merged_service_input(merged),
        update_tx=lambda conn, state, touched: _update_owned(
            conn, organizer_id, id, touched_update(state, touched)
        ),
    )

    star = json_response(200, gen.ServiceEnvelope(service=to_service_record(row))).to_starlette()

    # The replaced cover object is removed best-effort after the commit
    # (see cleanup_replaced_media) — a storage failure must not fail an
    # already-committed update. The ownership check ran inside the
    # transaction (db/service.update_owned_service_tx).
    if touched.get("photoUrl"):
        old = current.photo_url or ""
        new = row.photo_url or ""
        star.background = BackgroundTask(cleanup_replaced_media, organizer_id, old, new)
    return star


async def service_delete(
    request: Request,
    id: str,
    organizer_id: str = Depends(require_writable_organizer),
) -> StarletteResponse:
    """DELETE /api/services/{id}. Slots cascade on the services FK, but
    bookings hold their slots with ON DELETE RESTRICT, so a service whose
    slots were ever booked answers 409 — terminal for MVP, the booking
    rows are guest history and nothing removes them. The cover object is
    removed from R2 best-effort after the delete (see
    cleanup_replaced_media) — the photo_url rides along in the DELETE …
    RETURNING so a concurrent PUT cannot slip a new cover in between a
    read and the delete."""
    deleted = await delete_owned_service(organizer_id, id)
    if deleted is None or deleted[0] == "":
        raise ServiceNotFound()
    deleted_id, photo_url = deleted

    star = json_response(200, gen.DeletedServiceEnvelope(id=deleted_id)).to_starlette()
    star.background = BackgroundTask(cleanup_replaced_media, organizer_id, photo_url or "", "")
    return star
