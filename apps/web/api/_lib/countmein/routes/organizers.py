"""Organizer routes — registration, profile, language, media uploads.
Port of pkg/routes/organizers.go."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from starlette.requests import Request

if TYPE_CHECKING:
    from starlette.responses import Response as StarletteResponse

from .. import storage
from ..auth import peek_ticket
from ..auth.telegram import TICKET_PURPOSE_ORGANIZER
from ..contracts import models_gen as gen
from ..db.client import engine
from ..db.organizer import (
    get_organizer_profile,
    get_organizer_profile_tx,
    insert_organizer,
    update_organizer_language,
    update_organizer_profile_tx,
)
from ..db.rows import OrganizerRow, to_organizer_profile
from ..demo.resolve import resolve_cabinet_organizer_id
from ..httpx_ import (
    empty,
    error,
    internal,
    invalid_body,
    invalid_issues,
    json_response,
    organizer_error_response,
)
from ..httpx_.guards import read_body_or_413, require_writable_organizer
from ..httpx_.ratelimit import RateLimitConfig, client_ip, rate_limited
from ..i18n.locale import detect_locale
from ..validation.decode import (
    decode_create_avatar_upload_input,
    decode_create_service_photo_upload_input,
    decode_merged_organizer_input,
    decode_register_organizer_input,
    decode_update_organizer_language_input,
    decode_update_organizer_profile_input,
)
from .media import cleanup_replaced_media
from .mergepatch import merge_patch, patch_keys, require_merge_patch_content_type


def _locale(request: Request) -> str:
    return detect_locale(request.cookies, request.headers.get("accept-language", ""))


def _root(value: Any) -> Any:
    while hasattr(value, "root"):
        value = value.root
    return value


def _unique_constraint_name(err: BaseException) -> str | None:
    """The constraint name behind a 23505, or None when err is not a
    unique violation. Walks the exception chain like Go's errors.As over
    the wrapped pgconn error — the driver error may sit under a
    SQLAlchemy wrapper."""
    seen: set[int] = set()
    current: BaseException | None = err
    while current is not None and id(current) not in seen:
        code = getattr(current, "sqlstate", None) or getattr(current, "pgcode", None)
        if code == "23505":
            diag = getattr(current, "diag", None)
            name = getattr(diag, "constraint_name", None) if diag is not None else None
            return str(name or "")
        seen.add(id(current))
        current = current.__cause__ or current.__context__
    return None


@dataclass
class OrganizerUpdate:
    """The merged state plus the touched-key set, handed to the db layer
    so only intended columns are written (merge-patch semantics)."""

    state: Any
    touched: dict[str, bool]


def organizer_writable_state(o: OrganizerRow) -> dict[str, Any]:
    """The writable fields of an organizer row in their wire shape — the
    merge-patch base."""
    return {
        "name": o.name,
        "slug": o.slug,
        "timezone": o.timezone,
        "description": o.description,
        "location": o.location,
        "contact": o.contact,
        "photoUrl": o.photo_url,
    }


async def organizer_register(request: Request) -> StarletteResponse:
    """POST /api/organizers (ADR-008). The messenger identity comes from
    the auth ticket (validated server-side via the Telegram widget HMAC —
    never from the client). The ticket is only peeked here — it stays
    valid so the client can immediately exchange it for a session via
    Auth.js (signIn('telegram', {ticket}) consumes it)."""
    locale = _locale(request)

    # Registration is the one write reachable without any identity: a
    # ticket is required to succeed, but the endpoint itself can be
    # hammered. IP-keyed bucket keeps that cheap.
    limited = await rate_limited(
        request, "rl:register:" + client_ip(request), RateLimitConfig(limit=10, window=3600.0)
    )
    if limited is not None:
        return limited.to_starlette()

    body, resp = await read_body_or_413(request)
    if resp is not None:
        return resp.to_starlette()
    input, errs = decode_register_organizer_input(body)  # type: ignore[arg-type]
    if errs is not None:
        return invalid_issues(locale, errs).to_starlette()

    assert input is not None

    try:
        identity = await peek_ticket(str(_root(input.ticket)))
    except Exception as err:
        return internal(err).to_starlette()
    # Purpose claim: only an organizer-flow ticket may register an
    # organizer — a guest booking ticket must not be redeemable here.
    # Answered like an expired one.
    if identity is None or identity.purpose != TICKET_PURPOSE_ORGANIZER:
        return error(401, locale, "authSessionExpired").to_starlette()

    try:
        registered = await insert_organizer(input, identity)
    except Exception as err:
        # Unique violations (23505): slug vs messenger identity, told
        # apart by constraint name.
        constraint = _unique_constraint_name(err)
        if constraint is not None:
            if "slug" in constraint:
                return error(409, locale, "slugTaken").to_starlette()
            return error(409, locale, "accountExists").to_starlette()
        return internal(err).to_starlette()

    return json_response(201, gen.Registered(organizer=registered)).to_starlette()


async def organizer_me_get(request: Request) -> StarletteResponse:
    """GET /api/organizers/me: the organizer this request may view — the
    signed-in organizer, or the demo organizer with isDemo: true for
    anonymous visitors (/cabinet is open to everyone, ADR-010). Writes
    are never inferred from the GET response: organizer_me_put
    re-checks the session independently."""
    locale = _locale(request)
    organizer_id, is_demo = resolve_cabinet_organizer_id(request)

    try:
        row = await get_organizer_profile(organizer_id)
    except Exception as err:
        return internal(err).to_starlette()
    if row is None:
        # For the demo id this means the seed has not been run.
        if is_demo:
            return error(404, locale, "demoNotSeeded").to_starlette()
        return error(404, locale, "organizerNotFound").to_starlette()

    return json_response(
        200, gen.OrganizerEnvelope(organizer=to_organizer_profile(row, is_demo))
    ).to_starlette()


async def organizer_me_put(request: Request) -> StarletteResponse:
    """PUT /api/organizers/me. Takes a JSON Merge Patch body
    (RFC 7386/ADR-016): validate the patch, merge into the current state,
    validate the result."""
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
    _, errs = decode_update_organizer_profile_input(body)  # type: ignore[arg-type]
    if errs is not None:
        return invalid_body(locale, errs).to_starlette()

    assert _ is not None
    touched = patch_keys(body)  # type: ignore[arg-type]
    if touched is None:
        return error(400, locale, "nothingToUpdate").to_starlette()

    # Read → merge → write on one transaction: a separate read and write
    # let two concurrent PUTs merge against different snapshots and
    # silently lose columns.
    try:
        async with engine().begin() as conn:
            current = await get_organizer_profile_tx(conn, organizer_id)
            if current is None:
                return error(404, locale, "organizerNotFound").to_starlette()

            try:
                merged = merge_patch(organizer_writable_state(current), body)  # type: ignore[arg-type]
            except ValueError:
                return error(400, locale, "invalidInput").to_starlette()
            state, errs = decode_merged_organizer_input(merged)
            if errs is not None:
                return invalid_body(locale, errs).to_starlette()

            # A new avatar must live under this organizer's media prefix —
            # otherwise the row could point at an arbitrary host or
            # another organizer's object. Null clears and stays allowed.
            if touched.get("photoUrl") and state is not None and state.photoUrl is not None:
                if not storage.is_own_media_url(organizer_id, str(_root(state.photoUrl))):
                    return error(400, locale, "photoPrefix").to_starlette()

            try:
                row = await update_organizer_profile_tx(
                    conn, organizer_id, OrganizerUpdate(state=state, touched=touched)
                )
            except Exception as err:
                # A slug change to an occupied handle hits the unique
                # index — map it to 409 slugTaken like registration does,
                # instead of a bare 500.
                constraint = _unique_constraint_name(err)
                if constraint is not None and "slug" in constraint:
                    return error(409, locale, "slugTaken").to_starlette()
                mapped = organizer_error_response(err, locale)
                if mapped is not None:
                    return mapped.to_starlette()
                raise
            if row is None:
                return error(404, locale, "organizerNotFound").to_starlette()
    except Exception as err:
        return internal(err).to_starlette()

    out = json_response(200, gen.OrganizerEnvelope(organizer=to_organizer_profile(row, False)))
    star = out.to_starlette()

    # The replaced avatar object is removed best-effort after the commit
    # (see cleanup_replaced_media) — a storage failure must not fail an
    # already-committed update.
    if touched.get("photoUrl"):
        old = current.photo_url or ""
        new = row.photo_url or ""
        from starlette.background import BackgroundTask

        star.background = BackgroundTask(cleanup_replaced_media, organizer_id, old, new)
    return star


async def organizer_me_language(request: Request) -> StarletteResponse:
    """PATCH /api/organizers/me/language (ADR-011). The language
    switcher's server action calls this to persist the organizer's
    notification language. The cookie is already set by the action; this
    syncs the column so notification jobs render in the right locale.
    An unknown id answers 404 (0 rows affected); demo/anonymous callers
    are refused by require_writable_organizer."""
    locale = _locale(request)
    organizer_id, resp = await require_writable_organizer(request)
    if resp is not None:
        return resp.to_starlette()

    body, r = await read_body_or_413(request)
    if r is not None:
        return r.to_starlette()
    input, errs = decode_update_organizer_language_input(body)  # type: ignore[arg-type]
    if errs is not None:
        return invalid_body(locale, errs).to_starlette()

    assert input is not None

    try:
        await update_organizer_language(organizer_id, str(_root(input.language)))
    except Exception as err:
        mapped = organizer_error_response(err, locale)
        if mapped is not None:
            return mapped.to_starlette()
        return internal(err).to_starlette()
    return empty(204).to_starlette()


async def organizer_avatar(request: Request) -> StarletteResponse:
    """POST /api/organizers/me/avatar: a signed upload URL for the
    current organizer's avatar (uploadUrl, publicUrl, expiresAt).
    Read-only demo (ADR-010): denied before handing out an R2 upload
    URL, otherwise the demo avatar could be overwritten. Anonymous
    callers are demo cabinet visitors, so they get the same refusal."""
    locale = _locale(request)
    organizer_id, resp = await require_writable_organizer(request)
    if resp is not None:
        return resp.to_starlette()
    limited = await rate_limited(
        request, "rl:avatar:" + organizer_id, RateLimitConfig(limit=10, window=3600.0)
    )
    if limited is not None:
        return limited.to_starlette()

    body, r = await read_body_or_413(request)
    if r is not None:
        return r.to_starlette()
    input, errs = decode_create_avatar_upload_input(body)  # type: ignore[arg-type]
    if errs is not None:
        return invalid_body(locale, errs).to_starlette()

    assert input is not None

    try:
        target = storage.create_avatar_upload(organizer_id, input)
    except Exception as err:
        return internal(err).to_starlette()
    return json_response(200, target).to_starlette()


async def organizer_service_photo(request: Request) -> StarletteResponse:
    """POST /api/organizers/me/service-photo: a signed upload URL for a
    service cover photo. Lives under organizers/me rather than
    services/{id} on purpose: the "new service" form uploads a cover
    *before* the service row exists, so the only identity available is
    the organizer's. The resulting key is organizer-scoped, which is
    also what the photoUrl ownership check validates."""
    locale = _locale(request)
    organizer_id, resp = await require_writable_organizer(request)
    if resp is not None:
        return resp.to_starlette()
    limited = await rate_limited(
        request, "rl:service-photo:" + organizer_id, RateLimitConfig(limit=10, window=3600.0)
    )
    if limited is not None:
        return limited.to_starlette()

    body, r = await read_body_or_413(request)
    if r is not None:
        return r.to_starlette()
    input, errs = decode_create_service_photo_upload_input(body)  # type: ignore[arg-type]
    if errs is not None:
        return invalid_body(locale, errs).to_starlette()

    assert input is not None

    try:
        target = storage.create_service_photo_upload(organizer_id, input)
    except Exception as err:
        return internal(err).to_starlette()
    return json_response(200, target).to_starlette()
