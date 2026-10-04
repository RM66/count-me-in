"""Slot routes: the cabinet's slot CRUD.

The handlers lean on the exception hierarchy: guards/decoders raise,
the services layer raises ApiError subclasses, the app-level handler
renders them. The shared preamble is FastAPI dependencies (web/deps.py);
the merge-patch PATCH runs through apply_merge_patch on the request's
session.
"""

from __future__ import annotations

from typing import Literal

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask
from starlette.responses import Response as StarletteResponse

from ..contracts import models_gen as gen
from ..db.serializers import to_time_slot_record
from ..errors import ServiceNotFound, SlotNotFound
from ..models.time_slot import TimeSlot
from ..repositories import slot_repo
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
from .mergepatch import SLOT_FIELDS, apply_merge_patch

# One malformed-UUID rule for every /api/slots/{id} route: the JSON
# error envelope, never a bare 500.
_uuid_id = uuid_path_param("id")


async def _fetch_owned_slot(session: AsyncSession, organizer_id: str, slot_id: str) -> TimeSlot:
    """The merge-patch read — under FOR UPDATE, so two concurrent
    PATCHes serialize on the row instead of merging one snapshot, and
    the capacity check sees a booked_count stable against the atomic
    reserve."""
    row = await slot_repo.get_owned_slot_for_update(session, organizer_id, slot_id)
    if row is None:
        raise SlotNotFound()
    return row


async def _update_owned_slot(
    session: AsyncSession,
    row: TimeSlot,
    values: dict[str, object],
    *,
    organizer_id: str,
) -> TimeSlot:
    updated = await slot_service.update_owned_slot(session, organizer_id, row.id, row, values)
    if updated is None:
        raise SlotNotFound()
    return updated


async def slots_list(
    scope: tuple[str, bool] = Depends(cabinet_organizer),
    session: AsyncSession = Depends(get_db_session),
    upcoming: Literal["1"] | None = None,
) -> StarletteResponse:
    """GET /api/slots: slots across every service of the organizer this
    request may view (signed-in, or demo for anonymous, ADR-010).
    ?upcoming=1 drops started slots; the enum is the contract, so any
    other value answers 400."""
    organizer_id, _ = scope
    upcoming_only = upcoming is not None

    rows = await slot_repo.list_by_organizer(session, organizer_id, upcoming_only)
    slots = [to_time_slot_record(row) for row in rows]
    return json_response(200, gen.SlotsEnvelope(slots=slots))


_create_slot_dep = decoded(decode_create_time_slot_input)


async def slots_create(
    organizer_id: str = Depends(require_writable_organizer),
    slug: str = Depends(session_slug),
    body: ValidatedBody[gen.CreateTimeSlotInput] = Depends(_create_slot_dep),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """POST /api/slots: creates a slot under one of the signed-in
    organizer's services — ownership comes from the session, never the
    body; a foreign serviceId answers 404."""
    row = await slot_service.create_slot(session, organizer_id, body.model)
    if row is None:
        raise ServiceNotFound()
    star = json_response(201, gen.SlotEnvelope(slot=to_time_slot_record(row)))
    # A new slot appears on the organizer's page and the service page —
    # invalidate both (ADR-023).
    star.background = BackgroundTask(
        trigger_revalidation, public_tags(organizer_slug=slug, service_id=row.service_id)
    )
    return star


async def slot_get(
    id: str = Depends(_uuid_id),
    scope: tuple[str, bool] = Depends(cabinet_organizer),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """GET /api/slots/{id}, scoped to the organizer this request may
    view through the parent service."""
    organizer_id, _ = scope

    row = await slot_repo.get_owned_slot(session, organizer_id, id)
    if row is None:
        raise SlotNotFound()
    return json_response(200, gen.SlotEnvelope(slot=to_time_slot_record(row)))


_update_slot_dep = decoded(decode_update_time_slot_input)


async def slot_patch(
    id: str = Depends(_uuid_id),
    organizer_id: str = Depends(require_writable_organizer),
    slug: str = Depends(session_slug),
    _ct: None = Depends(merge_patch_content_type),
    body: ValidatedBody[gen.UpdateTimeSlotInput] = Depends(_update_slot_dep),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """PATCH /api/slots/{id}. Cannot move a slot to another service or
    touch bookedCount (seats change only via the atomic reserve);
    shrinking capacity below sold seats answers 409. JSON Merge Patch
    body (RFC 7386/ADR-016): validated, merged, re-validated."""
    row, _previous, _touched = await apply_merge_patch(
        session,
        body.raw,
        fetch=lambda s: _fetch_owned_slot(s, organizer_id, id),
        fields=SLOT_FIELDS,
        # startsAt is checked against the past only when the patch
        # touched it — the merged state always carries the current
        # value, which may legitimately be past.
        decode_merged=decode_merged_slot_input,
        update_tx=lambda s, current, values: _update_owned_slot(
            s, current, values, organizer_id=organizer_id
        ),
    )

    star = json_response(200, gen.SlotEnvelope(slot=to_time_slot_record(row)))
    # startsAt/duration/capacity/price render on both public surfaces.
    star.background = BackgroundTask(
        trigger_revalidation, public_tags(organizer_slug=slug, service_id=row.service_id)
    )
    return star


async def slot_delete(
    id: str = Depends(_uuid_id),
    organizer_id: str = Depends(require_writable_organizer),
    slug: str = Depends(session_slug),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """DELETE /api/slots/{id}. Refuses a slot referenced by any booking
    row, confirmed or cancelled (409 — the FK is ON DELETE RESTRICT, so
    the DB would reject anyway; the guard turns the opaque error into a
    clear refusal). Booking rows are guest history — the 409 is terminal
    for MVP. Guests are not notified from here."""
    deleted = await slot_service.delete_owned_slot(session, organizer_id, id)
    if deleted is None:
        raise SlotNotFound()

    # model_construct (not model_validate): the generated UUID pattern
    # constraint is unapplyable by pydantic-core; the id comes from the
    # DB.
    envelope = gen.DeletedSlotEnvelope.model_construct(id=deleted.id)
    star = json_response(200, envelope)
    star.background = BackgroundTask(
        trigger_revalidation,
        public_tags(organizer_slug=slug, service_id=deleted.service_id),
    )
    return star
