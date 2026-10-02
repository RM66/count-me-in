"""Slot routes: the cabinet's slot CRUD.

The handlers lean on the exception hierarchy: guards and
decoders raise, the services layer raises ApiError subclasses, and the
app-level handler renders them. The 404s that are *answers* (unknown or
foreign slot/service id) stay as explicit raises of the matching
ApiError subclass. The shared preamble is a set of FastAPI
dependencies (web/deps.py) declared in the handler signature. The
merge-patch PATCH runs through the shared transactional skeleton
(routes/mergepatch.apply_merge_patch) on the request's injected session.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask
from starlette.requests import Request
from starlette.responses import Response as StarletteResponse

from ..contracts import models_gen as gen
from ..contracts.domain import iso_date
from ..db.rows import TimeSlotRow
from ..db.serializers import to_time_slot_record
from ..errors import ServiceNotFound, SlotNotFound
from ..services import slot_service
from ..validation.decode import (
    decode_create_time_slot_input,
    decode_merged_slot_input,
    decode_update_time_slot_input,
)
from ..web import json_response
from ..web.deps import (
    ValidatedBody,
    cabinet_organizer,
    decoded,
    get_db_session,
    merge_patch_content_type,
    session_slug,
    uuid_path_param,
)
from ..web.guards import require_writable_organizer
from ..web.revalidate import public_tags, trigger_revalidation
from .mergepatch import apply_merge_patch, touched_update

# One malformed-UUID rule for every /api/slots/{id} route: the
# JSON error envelope, never a bare 500 from Postgres.
_uuid_id = uuid_path_param("id")


def slot_writable_state(s: TimeSlotRow) -> dict[str, Any]:
    """The writable fields of a slot row in their wire shape — the
    merge-patch base. startsAt is the ISO string the row already
    carries; a patch may replace it with an epoch number."""
    return {
        "startsAt": iso_date(s.starts_at),
        "durationMinutes": s.duration_minutes,
        "capacity": s.capacity,
        "price": s.price,
    }


async def _fetch_owned_slot(session: AsyncSession, organizer_id: str, slot_id: str) -> TimeSlotRow:
    row = await slot_service.get_owned_slot_tx(session, organizer_id, slot_id)
    if row is None:
        raise SlotNotFound()
    return row


async def _update_owned_slot(
    session: AsyncSession,
    organizer_id: str,
    slot_id: str,
    update: Any,
) -> TimeSlotRow:
    row = await slot_service.update_owned_slot_tx(session, organizer_id, slot_id, update)
    if row is None:
        raise SlotNotFound()
    return row


async def slots_list(
    request: Request,
    scope: tuple[str, bool] = Depends(cabinet_organizer),
    session: AsyncSession = Depends(get_db_session),
    upcoming: Literal["1"] | None = None,
) -> StarletteResponse:
    """GET /api/slots: lists slots across every service of the organizer
    this request may view (signed-in, or demo for anonymous visitors,
    ADR-010). ?upcoming=1 drops slots that have already started; the
    enum is the declared contract, so any other value answers 400."""
    organizer_id, _ = scope
    upcoming_only = upcoming is not None

    rows = await slot_service.list_slots(session, organizer_id, upcoming_only)
    slots = [to_time_slot_record(row) for row in rows]
    return json_response(200, gen.SlotsEnvelope(slots=slots)).to_starlette()


_create_slot_dep = decoded(decode_create_time_slot_input)


async def slots_create(
    request: Request,
    organizer_id: str = Depends(require_writable_organizer),
    slug: str = Depends(session_slug),
    body: ValidatedBody[gen.CreateTimeSlotInput] = Depends(_create_slot_dep),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """POST /api/slots: creates a slot under one of the signed-in
    organizer's services — ownership comes from the session, never the
    body: a serviceId belonging to someone else answers 404."""
    row = await slot_service.create_slot(session, organizer_id, body.model)
    if row is None:
        raise ServiceNotFound()
    star = json_response(201, gen.SlotEnvelope(slot=to_time_slot_record(row))).to_starlette()
    # A new upcoming slot appears on the organizer's public page and the
    # service page — invalidate both (ADR-023).
    star.background = BackgroundTask(
        trigger_revalidation, public_tags(organizer_slug=slug, service_id=row.service_id)
    )
    return star


async def slot_get(
    request: Request,
    id: str = Depends(_uuid_id),
    scope: tuple[str, bool] = Depends(cabinet_organizer),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """GET /api/slots/{id}, scoped to the organizer this request may
    view through the parent service."""
    organizer_id, _ = scope

    row = await slot_service.get_owned_slot(session, organizer_id, id)
    if row is None:
        raise SlotNotFound()
    return json_response(200, gen.SlotEnvelope(slot=to_time_slot_record(row))).to_starlette()


_update_slot_dep = decoded(decode_update_time_slot_input)


async def slot_patch(
    request: Request,
    id: str = Depends(_uuid_id),
    organizer_id: str = Depends(require_writable_organizer),
    slug: str = Depends(session_slug),
    _ct: None = Depends(merge_patch_content_type),
    body: ValidatedBody[gen.UpdateTimeSlotInput] = Depends(_update_slot_dep),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """PATCH /api/slots/{id}. Cannot move a slot to another service and
    never touches bookedCount (seats change only through the booking
    flow's atomic reserve); shrinking capacity below the seats already
    sold answers 409. Takes a JSON Merge Patch body (RFC 7386/ADR-016):
    the patch is validated, merged into the current state, and the
    result re-validated."""
    row, _current, _touched = await apply_merge_patch(
        session,
        body.raw,
        fetch=lambda s: _fetch_owned_slot(s, organizer_id, id),
        writable_state=slot_writable_state,
        # startsAt is only checked against the past when the patch
        # touched it (the merged state always carries the current value,
        # which may legitimately be past).
        decode_merged=lambda merged, touched: decode_merged_slot_input(
            merged, bool(touched.get("startsAt"))
        ),
        update_tx=lambda s, state, touched: _update_owned_slot(
            s, organizer_id, id, touched_update(state, touched)
        ),
    )

    star = json_response(200, gen.SlotEnvelope(slot=to_time_slot_record(row))).to_starlette()
    # startsAt/duration/capacity/price render on both public surfaces.
    star.background = BackgroundTask(
        trigger_revalidation, public_tags(organizer_slug=slug, service_id=row.service_id)
    )
    return star


async def slot_delete(
    request: Request,
    id: str = Depends(_uuid_id),
    organizer_id: str = Depends(require_writable_organizer),
    slug: str = Depends(session_slug),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """DELETE /api/slots/{id}. Refuses a slot that is referenced by any
    booking row, confirmed or cancelled (409 — the time_slots FK is ON
    DELETE RESTRICT, so the database would reject the delete anyway; the
    guard turns the opaque FK error into a clear refusal). The rows are
    guest history and nothing removes them, so the 409 is terminal for
    MVP. Guests are not notified from here."""
    deleted = await slot_service.delete_owned_slot(session, organizer_id, id)
    if deleted is None:
        raise SlotNotFound()

    # model_construct (not model_validate): the generated UUID pattern
    # constraint cannot be applied by pydantic-core, and the id comes
    # straight from the database.
    envelope = gen.DeletedSlotEnvelope.model_construct(id=deleted.id)
    star = json_response(200, envelope).to_starlette()
    star.background = BackgroundTask(
        trigger_revalidation,
        public_tags(organizer_slug=slug, service_id=deleted.service_id),
    )
    return star
