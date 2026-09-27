"""Organizer routes — registration, profile, language, media uploads.

The handlers lean on the exception hierarchy; the
shared preamble (rate limit → body → decode → guard) is a set of FastAPI
dependencies (web/deps.py) declared in the handler signature.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import Depends
from starlette.background import BackgroundTask
from starlette.requests import Request
from starlette.responses import Response as StarletteResponse

from .. import storage
from ..auth.telegram import TICKET_PURPOSE_ORGANIZER
from ..auth.ticket import peek_ticket
from ..contracts import models_gen as gen
from ..contracts.models import unwrap_root
from ..db.client import engine
from ..db.organizer import (
    get_organizer_profile,
    get_organizer_profile_tx,
    insert_organizer,
    update_organizer_language,
    update_organizer_profile_tx,
)
from ..db.rows import OrganizerRow, to_organizer_profile
from ..errors import (
    AccountExists,
    DemoNotSeeded,
    InvalidInput,
    NothingToUpdate,
    OrganizerNotFound,
    PhotoPrefix,
    SlugTaken,
    TicketExpired,
)
from ..validation.decode import (
    decode_create_avatar_upload_input,
    decode_create_service_photo_upload_input,
    decode_merged_organizer_input,
    decode_register_organizer_input,
    decode_update_organizer_language_input,
    decode_update_organizer_profile_input,
)
from ..web import empty, json_response
from ..web.deps import (
    ValidatedBody,
    cabinet_organizer,
    decoded,
    ip_rate_limit,
    merge_patch_content_type,
    organizer_rate_limit,
)
from ..web.guards import require_writable_organizer
from .media import cleanup_replaced_media
from .mergepatch import merge_patch, patch_keys


def _unique_constraint_name(err: BaseException) -> str | None:
    """The constraint name behind a 23505, or None when err is not a
    unique violation. Walks the exception chain over the wrapped driver
    error — the pgconn error may sit under a SQLAlchemy wrapper."""
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


_register_dep = decoded(decode_register_organizer_input)


async def organizer_register(
    request: Request,
    # Registration is the one write reachable without any identity: a
    # ticket is required to succeed, but the endpoint itself can be
    # hammered. IP-keyed bucket keeps that cheap.
    _limited: None = Depends(ip_rate_limit("rl:register:", 10, 3600.0)),
    body: ValidatedBody[gen.RegisterOrganizerInput] = Depends(_register_dep),
) -> StarletteResponse:
    """POST /api/organizers (ADR-008). The messenger identity comes from
    the auth ticket (validated server-side via the Telegram widget HMAC —
    never from the client). The ticket is only peeked here — it stays
    valid so the client can immediately exchange it for a session via
    Auth.js (signIn('telegram', {ticket}) consumes it)."""
    payload = body.model

    identity = await peek_ticket(str(unwrap_root(payload.ticket)))
    # Purpose claim: only an organizer-flow ticket may register an
    # organizer — a guest booking ticket must not be redeemable here.
    # Answered like an expired one, with the same wire key as the guest
    # flow's wrong-purpose answer (TicketExpired): one rule, one key,
    # and the endpoint cannot be used to test whether a ticket exists.
    if identity is None or identity.purpose != TICKET_PURPOSE_ORGANIZER:
        raise TicketExpired()

    try:
        registered = await insert_organizer(payload, identity)
    except Exception as err:
        # Unique violations (23505): slug vs messenger identity, told
        # apart by constraint name.
        constraint = _unique_constraint_name(err)
        if constraint is not None:
            if "slug" in constraint:
                raise SlugTaken() from err
            raise AccountExists() from err
        raise

    return json_response(201, gen.Registered(organizer=registered)).to_starlette()


async def organizer_me_get(
    request: Request,
    scope: tuple[str, bool] = Depends(cabinet_organizer),
) -> StarletteResponse:
    """GET /api/organizers/me: the organizer this request may view — the
    signed-in organizer, or the demo organizer with isDemo: true for
    anonymous visitors (/cabinet is open to everyone, ADR-010). Writes
    are never inferred from the GET response: organizer_me_put
    re-checks the session independently."""
    organizer_id, is_demo = scope

    row = await get_organizer_profile(organizer_id)
    if row is None:
        # For the demo id this means the seed has not been run.
        if is_demo:
            raise DemoNotSeeded()
        raise OrganizerNotFound()

    return json_response(
        200, gen.OrganizerEnvelope(organizer=to_organizer_profile(row, is_demo))
    ).to_starlette()


_update_profile_dep = decoded(decode_update_organizer_profile_input)


async def organizer_me_put(
    request: Request,
    organizer_id: str = Depends(require_writable_organizer),
    _ct: None = Depends(merge_patch_content_type),
    body: ValidatedBody[gen.UpdateOrganizerProfileInput] = Depends(_update_profile_dep),
) -> StarletteResponse:
    """PUT /api/organizers/me. Takes a JSON Merge Patch body
    (RFC 7386/ADR-016): validate the patch, merge into the current state,
    validate the result."""
    touched = patch_keys(body.raw)
    if touched is None:
        raise NothingToUpdate()

    # Read → merge → write on one transaction: a separate read and write
    # let two concurrent PUTs merge against different snapshots and
    # silently lose columns.
    async with engine().begin() as conn:
        current = await get_organizer_profile_tx(conn, organizer_id)
        if current is None:
            raise OrganizerNotFound()

        try:
            merged = merge_patch(organizer_writable_state(current), body.raw)
        except ValueError:
            raise InvalidInput() from None
        state = decode_merged_organizer_input(merged)

        # A new avatar must live under this organizer's media prefix —
        # otherwise the row could point at an arbitrary host or
        # another organizer's object. Null clears and stays allowed.
        if touched.get("photoUrl") and state.photoUrl is not None:
            if not storage.is_own_media_url(organizer_id, str(unwrap_root(state.photoUrl))):
                raise PhotoPrefix()

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
                raise SlugTaken() from err
            raise
        if row is None:
            raise OrganizerNotFound()

    out = json_response(200, gen.OrganizerEnvelope(organizer=to_organizer_profile(row, False)))
    star = out.to_starlette()

    # The replaced avatar object is removed best-effort after the commit
    # (see cleanup_replaced_media) — a storage failure must not fail an
    # already-committed update.
    if touched.get("photoUrl"):
        old = current.photo_url or ""
        new = row.photo_url or ""
        star.background = BackgroundTask(cleanup_replaced_media, organizer_id, old, new)
    return star


_update_language_dep = decoded(decode_update_organizer_language_input)


async def organizer_me_language(
    request: Request,
    organizer_id: str = Depends(require_writable_organizer),
    body: ValidatedBody[gen.UpdateOrganizerLanguageInput] = Depends(_update_language_dep),
) -> StarletteResponse:
    """PATCH /api/organizers/me/language (ADR-011). The language
    switcher's server action calls this to persist the organizer's
    notification language. The cookie is already set by the action; this
    syncs the column so notification jobs render in the right locale.
    An unknown id answers 404 (0 rows affected); demo/anonymous callers
    are refused by require_writable_organizer."""
    await update_organizer_language(organizer_id, str(unwrap_root(body.model.language)))
    return empty(204).to_starlette()


_avatar_dep = decoded(decode_create_avatar_upload_input)


async def organizer_avatar(
    request: Request,
    organizer_id: str = Depends(require_writable_organizer),
    _limited: None = Depends(organizer_rate_limit("rl:avatar:", 10, 3600.0)),
    body: ValidatedBody[gen.CreateAvatarUploadInput] = Depends(_avatar_dep),
) -> StarletteResponse:
    """POST /api/organizers/me/avatar: a signed upload URL for the
    current organizer's avatar (uploadUrl, publicUrl, expiresAt).
    Read-only demo (ADR-010): denied before handing out an R2 upload
    URL, otherwise the demo avatar could be overwritten. Anonymous
    callers are demo cabinet visitors, so they get the same refusal."""
    target = storage.create_avatar_upload(organizer_id, body.model)
    return json_response(200, target).to_starlette()


_service_photo_dep = decoded(decode_create_service_photo_upload_input)


async def organizer_service_photo(
    request: Request,
    organizer_id: str = Depends(require_writable_organizer),
    _limited: None = Depends(organizer_rate_limit("rl:service-photo:", 10, 3600.0)),
    body: ValidatedBody[gen.CreateServicePhotoUploadInput] = Depends(_service_photo_dep),
) -> StarletteResponse:
    """POST /api/organizers/me/service-photo: a signed upload URL for a
    service cover photo. Lives under organizers/me rather than
    services/{id} on purpose: the "new service" form uploads a cover
    *before* the service row exists, so the only identity available is
    the organizer's. The resulting key is organizer-scoped, which is
    also what the photoUrl ownership check validates."""
    target = storage.create_service_photo_upload(organizer_id, body.model)
    return json_response(200, target).to_starlette()
