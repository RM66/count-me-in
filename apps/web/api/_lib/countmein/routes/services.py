"""Service routes: the cabinet's service CRUD.

The handlers lean on the exception hierarchy: guards and
decoders raise, the db layer raises ApiError subclasses, and the
app-level handler renders them. The shared preamble is a set
of FastAPI dependencies (web/deps.py) declared in the handler
signature.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import Depends
from starlette.background import BackgroundTask
from starlette.requests import Request
from starlette.responses import Response as StarletteResponse

from .. import storage
from ..contracts import models_gen as gen
from ..contracts.models import unwrap_root
from ..db.client import engine
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
    InvalidInput,
    NothingToUpdate,
    PhotoPrefix,
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
    merge_patch_content_type,
)
from ..web.guards import require_writable_organizer
from .media import cleanup_replaced_media
from .mergepatch import merge_patch, patch_keys


@dataclass
class ServiceUpdate:
    """The merged state plus the touched-key set (merge-patch)."""

    state: Any
    touched: dict[str, bool]


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
    the body."""
    payload = body.model

    # A cover URL must live under this organizer's media prefix —
    # otherwise the row could point at an arbitrary host or another
    # organizer's object.
    if payload.photoUrl is not None:
        if not storage.is_own_media_url(organizer_id, str(unwrap_root(payload.photoUrl))):
            raise PhotoPrefix()

    row = await create_service(organizer_id, payload)
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
) -> StarletteResponse:
    """PUT /api/services/{id}. Takes a JSON Merge Patch body (absent key
    = keep, explicit null = clear, RFC 7386/ADR-016): the patch is
    validated first (a null on a non-nullable key is rejected before any
    read), then merged into the current state and the result
    re-validated."""
    touched = patch_keys(body.raw)
    if touched is None:
        raise NothingToUpdate()

    # Read → merge → write on one transaction.
    async with engine().begin() as conn:
        current = await get_owned_service_tx(conn, organizer_id, id)
        if current is None:
            raise ServiceNotFound()

        try:
            merged = merge_patch(service_writable_state(current), body.raw)
        except ValueError:
            raise InvalidInput() from None
        state = decode_merged_service_input(merged)

        # A new cover must live under this organizer's media prefix —
        # otherwise the row could point at an arbitrary host or
        # another organizer's object. Null clears and stays allowed.
        if touched.get("photoUrl") and state.photoUrl is not None:
            if not storage.is_own_media_url(organizer_id, str(unwrap_root(state.photoUrl))):
                raise PhotoPrefix()

        row = await update_owned_service_tx(
            conn, organizer_id, id, ServiceUpdate(state=state, touched=touched)
        )
        if row is None:
            raise ServiceNotFound()

    star = json_response(200, gen.ServiceEnvelope(service=to_service_record(row))).to_starlette()

    # The replaced cover object is removed best-effort after the commit
    # (see cleanup_replaced_media) — a storage failure must not fail an
    # already-committed update.
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
