"""Service routes: the cabinet's service CRUD.

The handlers lean on the exception hierarchy: guards/decoders raise,
the services layer raises ApiError subclasses, the app-level handler
renders them. The shared preamble is FastAPI dependencies (web/deps.py).
The merge-patch PATCH runs through apply_merge_patch on the request's
session; the media-ownership invariant is enforced inside the service
write (services/service_service.py).
"""

from __future__ import annotations

from typing import Any

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask, BackgroundTasks
from starlette.responses import Response as StarletteResponse

from ..contracts import models_gen as gen
from ..db.rows import ServiceRow
from ..db.serializers import to_service_record
from ..errors import (
    CannotCreateService,
    ServiceNotFound,
)
from ..services import service_service
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
    get_db_session,
    merge_patch_content_type,
    session_slug,
)
from ..web.guards import require_writable_organizer
from ..web.revalidate import public_tags, trigger_revalidation
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


async def _fetch_owned(session: AsyncSession, organizer_id: str, service_id: str) -> ServiceRow:
    row = await service_service.get_owned_service_tx(session, organizer_id, service_id)
    if row is None:
        raise ServiceNotFound()
    return row


async def _update_owned(
    session: AsyncSession,
    organizer_id: str,
    service_id: str,
    update: Any,
) -> ServiceRow:
    row = await service_service.update_owned_service_tx(session, organizer_id, service_id, update)
    if row is None:
        raise ServiceNotFound()
    return row


async def services_list(
    scope: tuple[str, bool] = Depends(cabinet_organizer),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """GET /api/services: the services of the organizer this request may
    view (signed-in, or demo for anonymous visitors, ADR-010)."""
    organizer_id, _ = scope

    rows = await service_service.list_services(session, organizer_id)
    services = [to_service_record(row) for row in rows]
    return json_response(200, gen.ServicesEnvelope(services=services)).to_starlette()


_create_service_dep = decoded(decode_create_service_input)


async def services_create(
    organizer_id: str = Depends(require_writable_organizer),
    slug: str = Depends(session_slug),
    body: ValidatedBody[gen.CreateServiceInput] = Depends(_create_service_dep),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """POST /api/services: creates a service owned by the signed-in
    organizer — organizerId comes from the session, never the body. The
    cover-URL ownership check runs inside the service write."""
    row = await service_service.create_service(session, organizer_id, body.model)
    if row is None:
        # Structurally unreachable backstop: a silent empty
        # INSERT … RETURNING must never 201.
        raise CannotCreateService()

    star = json_response(201, gen.ServiceEnvelope(service=to_service_record(row))).to_starlette()
    # A new service appears on the organizer's page, its own page and
    # the sitemap — invalidate all three (ADR-023).
    star.background = BackgroundTask(
        trigger_revalidation,
        public_tags(organizer_slug=slug, service_id=row.id, sitemap=True),
    )
    return star


async def service_get(
    id: str,
    scope: tuple[str, bool] = Depends(cabinet_organizer),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """GET /api/services/{id}, scoped to the organizer this request may
    view: a foreign id answers 404, not 403 — the endpoint never confirms
    that a foreign id exists."""
    organizer_id, _ = scope

    row = await service_service.get_owned_service(session, organizer_id, id)
    if row is None:
        raise ServiceNotFound()
    return json_response(200, gen.ServiceEnvelope(service=to_service_record(row))).to_starlette()


_update_service_dep = decoded(decode_update_service_input)


async def service_patch(
    id: str,
    organizer_id: str = Depends(require_writable_organizer),
    slug: str = Depends(session_slug),
    _ct: None = Depends(merge_patch_content_type),
    body: ValidatedBody[gen.UpdateServiceInput] = Depends(_update_service_dep),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """PATCH /api/services/{id}. JSON Merge Patch body (absent = keep,
    null = clear, RFC 7386/ADR-016): the patch is validated first (a null
    on a non-nullable key is rejected before any read), then merged and
    the result re-validated."""
    row, current, touched = await apply_merge_patch(
        session,
        body.raw,
        fetch=lambda s: _fetch_owned(s, organizer_id, id),
        writable_state=service_writable_state,
        decode_merged=lambda merged, _touched: decode_merged_service_input(merged),
        update_tx=lambda s, state, touched: _update_owned(
            s, organizer_id, id, touched_update(state, touched)
        ),
    )

    star = json_response(200, gen.ServiceEnvelope(service=to_service_record(row))).to_starlette()

    tasks = [
        # Service fields are embedded in its page and the organizer's
        # slot payloads — invalidate both.
        BackgroundTask(trigger_revalidation, public_tags(organizer_slug=slug, service_id=row.id))
    ]

    # Replaced cover removed best-effort post-commit (see
    # cleanup_replaced_media) — a storage failure must not fail the
    # committed update. Ownership was checked inside the transaction.
    if touched.get("photoUrl"):
        old = current.photo_url or ""
        new = row.photo_url or ""
        tasks.append(BackgroundTask(cleanup_replaced_media, organizer_id, old, new))
    star.background = BackgroundTasks(tasks)
    return star


async def service_delete(
    id: str,
    organizer_id: str = Depends(require_writable_organizer),
    slug: str = Depends(session_slug),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """DELETE /api/services/{id}. Slots cascade on the services FK, but
    bookings hold their slots with ON DELETE RESTRICT, so a service whose
    slots were ever booked answers 409 — terminal for MVP, booking rows
    are guest history. The cover is removed from R2 best-effort after the
    delete; photo_url rides along in DELETE … RETURNING so a concurrent
    PATCH cannot slip a new cover in between read and delete."""
    deleted = await service_service.delete_owned_service(session, organizer_id, id)
    if deleted is None or deleted[0] == "":
        raise ServiceNotFound()
    deleted_id, photo_url = deleted

    star = json_response(200, gen.DeletedServiceEnvelope(id=deleted_id)).to_starlette()
    star.background = BackgroundTasks(
        [
            # The service disappears from the organizer's page, its own
            # page and the sitemap.
            BackgroundTask(
                trigger_revalidation,
                public_tags(organizer_slug=slug, service_id=deleted_id, sitemap=True),
            ),
            BackgroundTask(cleanup_replaced_media, organizer_id, photo_url or "", ""),
        ]
    )
    return star
