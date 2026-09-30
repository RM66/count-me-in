"""Slot routes: the cabinet's slot CRUD.

The handlers lean on the exception hierarchy: guards and
decoders raise, the db layer raises ApiError subclasses, and the
app-level handler renders them. The 404s that are *answers* (unknown or
foreign slot/service id) stay as explicit raises of the matching
ApiError subclass. The shared preamble is a set of FastAPI
dependencies (web/deps.py) declared in the handler signature. The
merge-patch PUT runs through the shared transactional skeleton
(routes/mergepatch.apply_merge_patch).
"""

from __future__ import annotations

from typing import Any

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request
from starlette.responses import Response as StarletteResponse

from ..contracts import models_gen as gen
from ..contracts.domain import iso_date
from ..db.rows import TimeSlotRow, to_time_slot_record
from ..db.time_slot import (
    create_slot,
    delete_owned_slot,
    get_owned_slot,
    get_owned_slot_tx,
    list_slots,
    update_owned_slot_tx,
)
from ..errors import ServiceNotFound, SlotNotFound
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
    merge_patch_content_type,
    uuid_path_param,
)
from ..web.guards import require_writable_organizer
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
    row = await get_owned_slot_tx(session, organizer_id, slot_id)
    if row is None:
        raise SlotNotFound()
    return row


async def _update_owned_slot(
    session: AsyncSession,
    organizer_id: str,
    slot_id: str,
    update: Any,
) -> TimeSlotRow:
    row = await update_owned_slot_tx(session, organizer_id, slot_id, update)
    if row is None:
        raise SlotNotFound()
    return row


async def slots_list(
    request: Request,
    scope: tuple[str, bool] = Depends(cabinet_organizer),
    upcoming: str | None = None,
) -> StarletteResponse:
    """GET /api/slots: lists slots across every service of the organizer
    this request may view (signed-in, or demo for anonymous visitors,
    ADR-010). ?upcoming=1 drops slots that have already started."""
    organizer_id, _ = scope
    upcoming_only = upcoming is not None and upcoming == "1"

    rows = await list_slots(organizer_id, upcoming_only)
    slots = [to_time_slot_record(row) for row in rows]
    return json_response(200, gen.SlotsEnvelope(slots=slots)).to_starlette()


_create_slot_dep = decoded(decode_create_time_slot_input)


async def slots_create(
    request: Request,
    organizer_id: str = Depends(require_writable_organizer),
    body: ValidatedBody[gen.CreateTimeSlotInput] = Depends(_create_slot_dep),
) -> StarletteResponse:
    """POST /api/slots: creates a slot under one of the signed-in
    organizer's services — ownership comes from the session, never the
    body: a serviceId belonging to someone else answers 404."""
    row = await create_slot(organizer_id, body.model)
    if row is None:
        raise ServiceNotFound()
    return json_response(201, gen.SlotEnvelope(slot=to_time_slot_record(row))).to_starlette()


async def slot_get(
    request: Request,
    id: str = Depends(_uuid_id),
    scope: tuple[str, bool] = Depends(cabinet_organizer),
) -> StarletteResponse:
    """GET /api/slots/{id}, scoped to the organizer this request may
    view through the parent service."""
    organizer_id, _ = scope

    row = await get_owned_slot(organizer_id, id)
    if row is None:
        raise SlotNotFound()
    return json_response(200, gen.SlotEnvelope(slot=to_time_slot_record(row))).to_starlette()


_update_slot_dep = decoded(decode_update_time_slot_input)


async def slot_put(
    request: Request,
    id: str = Depends(_uuid_id),
    organizer_id: str = Depends(require_writable_organizer),
    _ct: None = Depends(merge_patch_content_type),
    body: ValidatedBody[gen.UpdateTimeSlotInput] = Depends(_update_slot_dep),
) -> StarletteResponse:
    """PUT /api/slots/{id}. Cannot move a slot to another service and
    never touches bookedCount (seats change only through the booking
    flow's atomic reserve); shrinking capacity below the seats already
    sold answers 409. Takes a JSON Merge Patch body (RFC 7386/ADR-016):
    the patch is validated, merged into the current state, and the
    result re-validated."""
    row, _current, _touched = await apply_merge_patch(
        body.raw,
        fetch=lambda session: _fetch_owned_slot(session, organizer_id, id),
        writable_state=slot_writable_state,
        # startsAt is only checked against the past when the patch
        # touched it (the merged state always carries the current value,
        # which may legitimately be past).
        decode_merged=lambda merged, touched: decode_merged_slot_input(
            merged, bool(touched.get("startsAt"))
        ),
        update_tx=lambda session, state, touched: _update_owned_slot(
            session, organizer_id, id, touched_update(state, touched)
        ),
    )

    return json_response(200, gen.SlotEnvelope(slot=to_time_slot_record(row))).to_starlette()


async def slot_delete(
    request: Request,
    id: str = Depends(_uuid_id),
    organizer_id: str = Depends(require_writable_organizer),
) -> StarletteResponse:
    """DELETE /api/slots/{id}. Refuses a slot that is referenced by any
    booking row, confirmed or cancelled (409 — the time_slots FK is ON
    DELETE RESTRICT, so the database would reject the delete anyway; the
    guard turns the opaque FK error into a clear refusal). The rows are
    guest history and nothing removes them, so the 409 is terminal for
    MVP. Guests are not notified from here."""
    deleted_id = await delete_owned_slot(organizer_id, id)
    if not deleted_id:
        raise SlotNotFound()

    # model_construct (not model_validate): the generated UUID pattern
    # constraint cannot be applied by pydantic-core, and the id comes
    # straight from the database.
    envelope = gen.DeletedSlotEnvelope.model_construct(id=deleted_id)
    return json_response(200, envelope).to_starlette()
