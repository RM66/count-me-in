"""Time-slot routes — the organizer's schedule CRUD. Ported from the
retired implementation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from starlette.requests import Request

if TYPE_CHECKING:
    from starlette.responses import Response as StarletteResponse

from ..contracts import models_gen as gen
from ..contracts.domain import iso_date
from ..db.client import engine
from ..db.rows import TimeSlotRow, to_time_slot_record
from ..db.timeslot import (
    create_slot,
    delete_owned_slot,
    get_owned_slot,
    get_owned_slot_tx,
    list_slots,
    update_owned_slot_tx,
)
from ..demo.resolve import resolve_cabinet_organizer_id
from ..httpx_ import error, internal, invalid_body, json_response, slot_error_response
from ..httpx_.guards import read_body_or_413, require_writable_organizer
from ..i18n.locale import detect_locale
from ..validation.decode import (
    decode_create_time_slot_input,
    decode_merged_slot_input,
    decode_update_time_slot_input,
)
from .mergepatch import merge_patch, patch_keys, require_merge_patch_content_type


def _locale(request: Request) -> str:
    return detect_locale(request.cookies, request.headers.get("accept-language", ""))


@dataclass
class SlotUpdate:
    """The merged state plus the touched-key set (merge-patch)."""

    state: Any
    touched: dict[str, bool]


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


async def slots_list(request: Request, upcoming: str | None = None) -> StarletteResponse:
    """GET /api/slots: lists slots across every service of the organizer
    this request may view (signed-in, or demo for anonymous visitors,
    ADR-010). ?upcoming=1 drops slots that have already started."""
    organizer_id, _ = resolve_cabinet_organizer_id(request)
    upcoming_only = upcoming is not None and upcoming == "1"

    try:
        rows = await list_slots(organizer_id, upcoming_only)
    except Exception as err:
        return internal(err).to_starlette()
    slots = [to_time_slot_record(row) for row in rows]
    return json_response(200, gen.SlotsEnvelope(slots=slots)).to_starlette()


async def slots_create(request: Request) -> StarletteResponse:
    """POST /api/slots: creates a slot under one of the signed-in
    organizer's services — ownership comes from the session, never the
    body: a serviceId belonging to someone else answers 404."""
    locale = _locale(request)
    organizer_id, resp = await require_writable_organizer(request)
    if resp is not None:
        return resp.to_starlette()

    body, r = await read_body_or_413(request)
    if r is not None:
        return r.to_starlette()
    input, errs = decode_create_time_slot_input(body)  # type: ignore[arg-type]
    if errs is not None:
        return invalid_body(locale, errs).to_starlette()

    assert input is not None

    try:
        row = await create_slot(organizer_id, input)
    except Exception as err:
        return internal(err).to_starlette()
    if row is None:
        return error(404, locale, "serviceNotFound").to_starlette()
    return json_response(201, gen.SlotEnvelope(slot=to_time_slot_record(row))).to_starlette()


async def slot_get(request: Request, id: str) -> StarletteResponse:
    """GET /api/slots/{id}, scoped to the organizer this request may
    view through the parent service."""
    locale = _locale(request)
    organizer_id, _ = resolve_cabinet_organizer_id(request)

    try:
        row = await get_owned_slot(organizer_id, id)
    except Exception as err:
        return internal(err).to_starlette()
    if row is None:
        return error(404, locale, "slotNotFound").to_starlette()
    return json_response(200, gen.SlotEnvelope(slot=to_time_slot_record(row))).to_starlette()


async def slot_put(request: Request, id: str) -> StarletteResponse:
    """PUT /api/slots/{id}. Cannot move a slot to another service and
    never touches bookedCount (seats change only through the booking
    flow's atomic reserve); shrinking capacity below the seats already
    sold answers 409. Takes a JSON Merge Patch body (RFC 7386/ADR-016):
    the patch is validated, merged into the current state, and the
    result re-validated."""
    locale = _locale(request)
    organizer_id, resp = await require_writable_organizer(request)
    if resp is not None:
        return resp.to_starlette()
    ct = require_merge_patch_content_type(request, locale)
    if ct is not None:
        return ct.to_starlette()

    body, r = await read_body_or_413(request)
    if r is not None:
        return r.to_starlette()
    _, errs = decode_update_time_slot_input(body)  # type: ignore[arg-type]
    if errs is not None:
        return invalid_body(locale, errs).to_starlette()

    assert _ is not None
    touched = patch_keys(body)  # type: ignore[arg-type]
    if touched is None:
        return error(400, locale, "nothingToUpdate").to_starlette()

    # Read → merge → write on one transaction.
    try:
        async with engine().begin() as conn:
            current = await get_owned_slot_tx(conn, organizer_id, id)
            if current is None:
                return error(404, locale, "slotNotFound").to_starlette()

            try:
                merged = merge_patch(slot_writable_state(current), body)  # type: ignore[arg-type]
            except ValueError:
                return error(400, locale, "invalidInput").to_starlette()
            state, errs = decode_merged_slot_input(merged, bool(touched.get("startsAt")))
            if errs is not None:
                return invalid_body(locale, errs).to_starlette()

            try:
                row = await update_owned_slot_tx(
                    conn, organizer_id, id, SlotUpdate(state=state, touched=touched)
                )
            except Exception as err:
                # One handler, two inline errors — no risk of disagreeing
                # with itself, so these live here instead of a shared
                # mapper.
                mapped = slot_error_response(err, locale)
                if mapped is not None:
                    return mapped.to_starlette()
                raise
            if row is None:
                return error(404, locale, "slotNotFound").to_starlette()
    except Exception as err:
        return internal(err).to_starlette()

    return json_response(200, gen.SlotEnvelope(slot=to_time_slot_record(row))).to_starlette()


async def slot_delete(request: Request, id: str) -> StarletteResponse:
    """DELETE /api/slots/{id}. Refuses a slot that is referenced by any
    booking row, confirmed or cancelled (409 — the time_slots FK is ON
    DELETE RESTRICT, so the database would reject the delete anyway; the
    guard turns the opaque FK error into a clear refusal). The rows are
    guest history and nothing removes them, so the 409 is terminal for
    MVP. Guests are not notified from here."""
    locale = _locale(request)
    organizer_id, resp = await require_writable_organizer(request)
    if resp is not None:
        return resp.to_starlette()

    try:
        deleted_id = await delete_owned_slot(organizer_id, id)
    except Exception as err:
        mapped = slot_error_response(err, locale)
        if mapped is not None:
            return mapped.to_starlette()
        return internal(err).to_starlette()
    if not deleted_id:
        return error(404, locale, "slotNotFound").to_starlette()

    # DeletedSlotEnvelope.id is UUIDModel — its generated pattern
    # constraint cannot be applied to a coerced UUID by pydantic-core,
    # so the wrapper is constructed without re-validation (the id comes
    # straight from the database and is already canonical).
    envelope = gen.DeletedSlotEnvelope(id=gen.UUIDModel.model_construct(root=deleted_id))  # type: ignore[arg-type]
    return json_response(200, envelope).to_starlette()
