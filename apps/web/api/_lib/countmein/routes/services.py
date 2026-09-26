"""Service routes — the organizer's service CRUD. Port of
pkg/routes/services.go."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from starlette.background import BackgroundTask
from starlette.requests import Request

if TYPE_CHECKING:
    from starlette.responses import Response as StarletteResponse

from .. import storage
from ..contracts import models_gen as gen
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
from ..demo.resolve import resolve_cabinet_organizer_id
from ..httpx_ import (
    error,
    internal,
    invalid_body,
    json_response,
    service_error_response,
)
from ..httpx_.guards import read_body_or_413, require_writable_organizer
from ..i18n.locale import detect_locale
from ..validation.decode import (
    decode_create_service_input,
    decode_merged_service_input,
    decode_update_service_input,
)
from .media import cleanup_replaced_media
from .mergepatch import merge_patch, patch_keys, require_merge_patch_content_type


def _locale(request: Request) -> str:
    return detect_locale(request.cookies, request.headers.get("accept-language", ""))


def _root(value: Any) -> Any:
    while hasattr(value, "root"):
        value = value.root
    return value


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


async def services_list(request: Request) -> StarletteResponse:
    """GET /api/services: lists the services of the organizer this
    request may view (the signed-in organizer, or the demo organizer for
    anonymous visitors, ADR-010)."""
    organizer_id, _ = resolve_cabinet_organizer_id(request)

    try:
        rows = await list_services(organizer_id)
    except Exception as err:
        return internal(err).to_starlette()
    services = [to_service_record(row) for row in rows]
    return json_response(200, gen.ServicesEnvelope(services=services)).to_starlette()


async def services_create(request: Request) -> StarletteResponse:
    """POST /api/services: creates a service owned by the signed-in
    organizer — organizerId always comes from the session, never from
    the body."""
    locale = _locale(request)
    organizer_id, resp = await require_writable_organizer(request)
    if resp is not None:
        return resp.to_starlette()

    body, r = await read_body_or_413(request)
    if r is not None:
        return r.to_starlette()
    input, errs = decode_create_service_input(body)  # type: ignore[arg-type]
    if errs is not None:
        return invalid_body(locale, errs).to_starlette()

    assert input is not None

    # A cover URL must live under this organizer's media prefix —
    # otherwise the row could point at an arbitrary host or another
    # organizer's object.
    if input is not None and input.photoUrl is not None:
        if not storage.is_own_media_url(organizer_id, str(_root(input.photoUrl))):
            return error(400, locale, "photoPrefix").to_starlette()

    try:
        row = await create_service(organizer_id, input)
    except Exception as err:
        return internal(err).to_starlette()
    if row is None:
        # Structurally unreachable (INSERT … RETURNING either errors or
        # returns the row) — kept as defensive parity with the TS check,
        # where drizzle's .returning() could yield an empty array.
        return error(500, locale, "cannotCreateService").to_starlette()

    return json_response(201, gen.ServiceEnvelope(service=to_service_record(row))).to_starlette()


async def service_get(request: Request, id: str) -> StarletteResponse:
    """GET /api/services/{id}, scoped to the organizer this request may
    view: an id belonging to someone else answers 404, not 403, so the
    endpoint never confirms that a foreign id exists."""
    locale = _locale(request)
    organizer_id, _ = resolve_cabinet_organizer_id(request)

    try:
        row = await get_owned_service(organizer_id, id)
    except Exception as err:
        return internal(err).to_starlette()
    if row is None:
        return error(404, locale, "serviceNotFound").to_starlette()
    return json_response(200, gen.ServiceEnvelope(service=to_service_record(row))).to_starlette()


async def service_put(request: Request, id: str) -> StarletteResponse:
    """PUT /api/services/{id}. Takes a JSON Merge Patch body (absent key
    = keep, explicit null = clear, RFC 7386/ADR-016): the patch is
    validated first (a null on a non-nullable key is rejected before any
    read), then merged into the current state and the result
    re-validated."""
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
    _, errs = decode_update_service_input(body)  # type: ignore[arg-type]
    if errs is not None:
        return invalid_body(locale, errs).to_starlette()

    assert _ is not None
    touched = patch_keys(body)  # type: ignore[arg-type]
    if touched is None:
        return error(400, locale, "nothingToUpdate").to_starlette()

    # Read → merge → write on one transaction.
    try:
        async with engine().begin() as conn:
            current = await get_owned_service_tx(conn, organizer_id, id)
            if current is None:
                return error(404, locale, "serviceNotFound").to_starlette()

            try:
                merged = merge_patch(service_writable_state(current), body)  # type: ignore[arg-type]
            except ValueError:
                return error(400, locale, "invalidInput").to_starlette()
            state, errs = decode_merged_service_input(merged)
            if errs is not None:
                return invalid_body(locale, errs).to_starlette()

            # A new cover must live under this organizer's media prefix —
            # otherwise the row could point at an arbitrary host or
            # another organizer's object. Null clears and stays allowed.
            if touched.get("photoUrl") and state is not None and state.photoUrl is not None:
                if not storage.is_own_media_url(organizer_id, str(_root(state.photoUrl))):
                    return error(400, locale, "photoPrefix").to_starlette()

            try:
                row = await update_owned_service_tx(
                    conn, organizer_id, id, ServiceUpdate(state=state, touched=touched)
                )
            except Exception as err:
                mapped = service_error_response(err, locale)
                if mapped is not None:
                    return mapped.to_starlette()
                raise
            if row is None:
                return error(404, locale, "serviceNotFound").to_starlette()
    except Exception as err:
        return internal(err).to_starlette()

    star = json_response(200, gen.ServiceEnvelope(service=to_service_record(row))).to_starlette()

    # The replaced cover object is removed best-effort after the commit
    # (see cleanup_replaced_media) — a storage failure must not fail an
    # already-committed update.
    if touched.get("photoUrl"):
        old = current.photo_url or ""
        new = row.photo_url or ""
        star.background = BackgroundTask(cleanup_replaced_media, organizer_id, old, new)
    return star


async def service_delete(request: Request, id: str) -> StarletteResponse:
    """DELETE /api/services/{id}. Slots cascade on the services FK, but
    bookings hold their slots with ON DELETE RESTRICT, so a service whose
    slots were ever booked answers 409 — terminal for MVP, the booking
    rows are guest history and nothing removes them. The cover object is
    removed from R2 best-effort after the delete (see
    cleanup_replaced_media) — the photo_url rides along in the DELETE …
    RETURNING so a concurrent PUT cannot slip a new cover in between a
    read and the delete."""
    locale = _locale(request)
    organizer_id, resp = await require_writable_organizer(request)
    if resp is not None:
        return resp.to_starlette()

    try:
        deleted = await delete_owned_service(organizer_id, id)
    except Exception as err:
        mapped = service_error_response(err, locale)
        if mapped is not None:
            return mapped.to_starlette()
        return internal(err).to_starlette()
    if deleted is None or deleted[0] == "":
        return error(404, locale, "serviceNotFound").to_starlette()
    deleted_id, photo_url = deleted

    star = json_response(200, gen.DeletedServiceEnvelope(id=deleted_id)).to_starlette()  # type: ignore[arg-type]
    star.background = BackgroundTask(cleanup_replaced_media, organizer_id, photo_url or "", "")
    return star
