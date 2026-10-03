"""Organizer routes — registration, profile, language, media uploads.

Handlers lean on the exception hierarchy; the shared preamble (rate
limit → body → decode → guard) is FastAPI dependencies (web/deps.py).
The merge-patch PATCH runs through routes/mergepatch.apply_merge_patch
on the request's session; the media-ownership invariant is enforced in
services/organizer_service.update_organizer_profile_tx.
"""

from __future__ import annotations

from typing import Any

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask, BackgroundTasks
from starlette.responses import Response as StarletteResponse

from .. import storage
from ..auth.telegram import TICKET_PURPOSE_ORGANIZER
from ..auth.ticket import peek_ticket
from ..contracts import models_gen as gen
from ..db.rows import OrganizerRow
from ..db.serializers import to_organizer_profile
from ..errors import (
    AccountExists,
    DemoNotSeeded,
    OrganizerNotFound,
    SlugTaken,
    TicketExpired,
    walk_exception_chain,
)
from ..services import organizer_service
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
    get_db_session,
    ip_rate_limit,
    merge_patch_content_type,
    organizer_rate_limit,
)
from ..web.guards import require_writable_organizer
from ..web.revalidate import public_tags, trigger_revalidation
from .media import cleanup_replaced_media
from .mergepatch import apply_merge_patch, touched_update


def _unique_constraint_name(err: BaseException) -> str | None:
    """The constraint name behind a 23505, or None. Walks the exception
    chain — the pgconn error may sit under a SQLAlchemy wrapper."""
    for current in walk_exception_chain(err):
        code = getattr(current, "sqlstate", None) or getattr(current, "pgcode", None)
        if code == "23505":
            diag = getattr(current, "diag", None)
            name = getattr(diag, "constraint_name", None) if diag is not None else None
            return str(name or "")
    return None


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


async def _fetch_profile(session: AsyncSession, organizer_id: str) -> OrganizerRow:
    row = await organizer_service.get_organizer_profile_tx(session, organizer_id)
    if row is None:
        raise OrganizerNotFound()
    return row


async def _update_profile(
    session: AsyncSession,
    organizer_id: str,
    update: Any,
) -> OrganizerRow:
    row = await organizer_service.update_organizer_profile_tx(session, organizer_id, update)
    if row is None:
        raise OrganizerNotFound()
    return row


_register_dep = decoded(decode_register_organizer_input)


async def organizer_register(
    # The one write reachable with no identity — the endpoint can be
    # hammered; an IP-keyed bucket keeps that cheap.
    _limited: None = Depends(ip_rate_limit("rl:register:", 10, 3600.0)),
    body: ValidatedBody[gen.RegisterOrganizerInput] = Depends(_register_dep),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """POST /api/organizers (ADR-008). The messenger identity comes from
    the auth ticket (validated server-side via the Telegram widget
    HMAC). The ticket is only peeked — it stays valid so the client can
    exchange it for a session via Auth.js (signIn('telegram', {ticket})
    consumes it)."""
    payload = body.model

    identity = await peek_ticket(str(payload.ticket))
    # Only an organizer-flow ticket may register — a wrong-purpose one
    # answers like an expired one, so the endpoint cannot probe ticket
    # existence.
    if identity is None or identity.purpose != TICKET_PURPOSE_ORGANIZER:
        raise TicketExpired()

    try:
        row = await organizer_service.insert_organizer(session, payload, identity)
    except Exception as err:
        # Unique violations (23505): slug vs messenger identity, told
        # apart by constraint name.
        constraint = _unique_constraint_name(err)
        if constraint is not None:
            if "slug" in constraint:
                raise SlugTaken() from err
            raise AccountExists() from err
        raise

    # RegisteredOrganizer is the wire record — the route projects the row.
    registered = gen.RegisteredOrganizer.model_construct(id=row.id, slug=row.slug)

    star = json_response(201, gen.RegistrationResponse(organizer=registered)).to_starlette()
    # A new slug appears in the sitemap and gets a public page —
    # invalidate both tags after commit (best-effort, ADR-023).
    star.background = BackgroundTask(
        trigger_revalidation,
        public_tags(organizer_slug=row.slug, sitemap=True),
    )
    return star


async def organizer_me_get(
    scope: tuple[str, bool] = Depends(cabinet_organizer),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """GET /api/organizers/me: the organizer this request may view —
    the signed-in one, or the demo organizer with isDemo: true for
    anonymous visitors (/cabinet is open, ADR-010). Writes are never
    inferred from this GET: organizer_me_patch re-checks the session."""
    organizer_id, is_demo = scope

    row = await organizer_service.get_organizer_profile(session, organizer_id)
    if row is None:
        # For the demo id this means the seed has not been run.
        if is_demo:
            raise DemoNotSeeded()
        raise OrganizerNotFound()

    return json_response(
        200, gen.OrganizerEnvelope(organizer=to_organizer_profile(row, is_demo))
    ).to_starlette()


_update_profile_dep = decoded(decode_update_organizer_profile_input)


async def organizer_me_patch(
    organizer_id: str = Depends(require_writable_organizer),
    _ct: None = Depends(merge_patch_content_type),
    body: ValidatedBody[gen.UpdateOrganizerProfileInput] = Depends(_update_profile_dep),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """PATCH /api/organizers/me. Takes a JSON Merge Patch body
    (RFC 7386/ADR-016): validate the patch, merge into the current state,
    validate the result."""
    try:
        row, current, touched = await apply_merge_patch(
            session,
            body.raw,
            fetch=lambda s: _fetch_profile(s, organizer_id),
            writable_state=organizer_writable_state,
            decode_merged=lambda merged, _touched: decode_merged_organizer_input(merged),
            update_tx=lambda s, state, touched: _update_profile(
                s, organizer_id, touched_update(state, touched)
            ),
        )
    except Exception as err:
        # A slug change onto an occupied handle hits the unique index —
        # map to 409 slugTaken like registration. Only the UPDATE can
        # produce a 23505; everything else re-raises.
        constraint = _unique_constraint_name(err)
        if constraint is not None and "slug" in constraint:
            raise SlugTaken() from err
        raise

    star = json_response(
        200, gen.OrganizerEnvelope(organizer=to_organizer_profile(row, False))
    ).to_starlette()

    tasks = [
        # The public page embeds every touched field — and when the
        # slug moved, the OLD slug's cached page must go stale too (it
        # now answers 404), plus the sitemap.
        BackgroundTask(
            trigger_revalidation,
            public_tags(
                organizer_slug=row.slug,
                sitemap=touched.get("slug", False),
            )
            + (public_tags(organizer_slug=current.slug) if current.slug != row.slug else []),
        )
    ]

    # Replaced avatar is removed best-effort after commit (see
    # cleanup_replaced_media); the ownership check ran inside the tx
    # (organizer_service.update_organizer_profile_tx).
    if touched.get("photoUrl"):
        old = current.photo_url or ""
        new = row.photo_url or ""
        tasks.append(BackgroundTask(cleanup_replaced_media, organizer_id, old, new))
    star.background = BackgroundTasks(tasks)
    return star


_update_language_dep = decoded(decode_update_organizer_language_input)


async def organizer_me_language(
    organizer_id: str = Depends(require_writable_organizer),
    body: ValidatedBody[gen.UpdateOrganizerLanguageInput] = Depends(_update_language_dep),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """PATCH /api/organizers/me/language (ADR-011): persist the
    notification language — the action already set the cookie, this
    syncs the column so notification jobs render in the right locale.
    Demo/anonymous callers are refused by require_writable_organizer."""
    await organizer_service.update_organizer_language(
        session, organizer_id, str(body.model.language)
    )
    return empty(204).to_starlette()


_avatar_dep = decoded(decode_create_avatar_upload_input)


async def organizer_avatar(
    organizer_id: str = Depends(require_writable_organizer),
    _limited: None = Depends(organizer_rate_limit("rl:avatar:", 10, 3600.0)),
    body: ValidatedBody[gen.CreateAvatarUploadInput] = Depends(_avatar_dep),
) -> StarletteResponse:
    """POST /api/organizers/me/avatar: signed upload URL for the
    organizer's avatar. Demo is read-only (ADR-010) — denied before an
    R2 URL is handed out; anonymous cabinet visitors get the same
    refusal."""
    target = storage.create_avatar_upload(organizer_id, body.model)
    return json_response(200, target).to_starlette()


_service_photo_dep = decoded(decode_create_service_photo_upload_input)


async def organizer_service_photo(
    organizer_id: str = Depends(require_writable_organizer),
    _limited: None = Depends(organizer_rate_limit("rl:service-photo:", 10, 3600.0)),
    body: ValidatedBody[gen.CreateServicePhotoUploadInput] = Depends(_service_photo_dep),
) -> StarletteResponse:
    """POST /api/organizers/me/service-photo: signed upload URL for a
    service cover. Under organizers/me on purpose: the "new service"
    form uploads a cover *before* the service row exists, so only the
    organizer identity is available — hence the organizer-scoped key
    the photoUrl check validates."""
    target = storage.create_service_photo_upload(organizer_id, body.model)
    return json_response(200, target).to_starlette()
