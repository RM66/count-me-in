"""Organizer service — profile reads and writes.

Two projections exist downstream of this module (OrganizerProfile for
the owner, PublicOrganizer for guests) — they live in db/serializers.py
so the messenger identity cannot leak to a public page through this
boundary.

Every write is owner-scoped; the demo guard runs inside every write
(defense in depth — routes already refuse the demo account).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..contracts import domain
from ..contracts import models_gen as gen
from ..contracts.payloads import AuthTicketPayload
from ..db.rows import OrganizerRow, from_model_organizer
from ..db.shared import TouchedUpdate, new_id
from ..demo import refuse_demo_write
from ..errors import NothingToUpdate, OrganizerNotFound, PhotoPrefix
from ..repositories import organizer_repo


async def get_organizer_profile(session: AsyncSession, organizer_id: str) -> OrganizerRow | None:
    """Begin-wrapped variant of get_organizer_profile_tx for callers that
    own no transaction — one call is one committed read unit."""
    async with session.begin():
        return await get_organizer_profile_tx(session, organizer_id)


async def get_organizer_profile_tx(session: AsyncSession, organizer_id: str) -> OrganizerRow | None:
    """The profile for the organizer this request may view; None when the
    id does not exist (e.g. demo not yet seeded). The merge-patch route
    reads the current state and writes the merged state on one
    transaction so concurrent PATCHes cannot lose columns."""
    model = await organizer_repo.get_by_id(session, organizer_id)
    return from_model_organizer(model) if model is not None else None


async def exists_organizer_by_messenger(
    session: AsyncSession, messenger: str, messenger_id: str
) -> bool:
    """Used by the signup flow to decide sign-in vs registration."""
    async with session.begin():
        return await organizer_repo.exists_by_messenger(session, messenger, messenger_id)


async def insert_organizer(
    session: AsyncSession,
    payload: gen.RegisterOrganizerInput,
    identity: AuthTicketPayload,
) -> OrganizerRow:
    """Register an organizer; the messenger identity comes from the
    peeked ticket (validated server-side), never from the body. A 23505
    surfaces as the raw driver error for the route to map to
    slugTaken / accountExists by constraint name."""
    # The wire schema makes language required, but a None here must
    # never crash the function — fall back to the default locale.
    # (--use-type-alias renders scalar schemas as plain Annotated
    # types, so no RootModel unwrapping is needed before SQL.)
    language = domain.deref_or(payload.language, domain.DEFAULT_LOCALE)
    async with session.begin():
        model = await organizer_repo.insert_organizer(
            session,
            id=new_id(),
            slug=str(payload.slug),
            name=str(payload.name),
            messenger=identity.messenger,
            messenger_id=identity.messenger_id,
            timezone=str(payload.timezone),
            language=language,
            contact=payload.contact,
            photo_url=identity.photo_url,
        )
    return from_model_organizer(model)


async def update_organizer_profile_tx(
    session: AsyncSession,
    organizer_id: str,
    update: TouchedUpdate[gen.UpdateOrganizerProfileInput],
) -> OrganizerRow | None:
    """Editable fields only; messenger identity, id and createdAt are set
    at registration and never editable. Absent keys are left untouched,
    explicit nulls clear the column (merge-patch semantics, ADR-016).
    Runs on the caller's transaction — the merge-patch skeleton reads
    and writes on one tx.

    Defense in depth: routes already refuse the demo account via
    require_writable_organizer, but a direct service call must not be
    able to write the read-only demo organizer either. The
    media-ownership invariant lives here too — a touched photoUrl must
    stay under this organizer's media prefix, checked inside the
    transaction before any column is written."""
    refuse_demo_write(organizer_id)
    state = update.state
    touched = update.touched
    if touched.get("photoUrl") and state.photoUrl is not None:
        if not storage.is_own_media_url(organizer_id, str(state.photoUrl)):
            raise PhotoPrefix()
    # Column-keyed touched values: absent keys are left untouched,
    # explicit nulls clear the column (merge-patch semantics, ADR-016).
    # Core update() instead of f-string SET concatenation.
    values: dict[str, Any] = {}
    if touched.get("name") and state.name is not None:
        values["name"] = str(state.name)
    if touched.get("slug") and state.slug is not None:
        values["slug"] = str(state.slug)
    if touched.get("timezone") and state.timezone is not None:
        values["timezone"] = str(state.timezone)
    if touched.get("description"):
        values["description"] = str(state.description) if state.description is not None else None
    if touched.get("location"):
        values["location"] = str(state.location) if state.location is not None else None
    if touched.get("contact"):
        values["contact"] = str(state.contact) if state.contact is not None else None
    if touched.get("photoUrl"):
        values["photo_url"] = str(state.photoUrl) if state.photoUrl is not None else None
    if not values:
        raise NothingToUpdate()

    model = await organizer_repo.update_profile(session, organizer_id, values)
    return from_model_organizer(model) if model is not None else None


async def update_organizer_language(
    session: AsyncSession, organizer_id: str, language: str
) -> None:
    """Set the organizer's notification language (ADR-011). An unknown
    id (0 rows affected) is an OrganizerNotFound so a stale session
    answers 404 instead of a silent success."""
    refuse_demo_write(organizer_id)
    async with session.begin():
        if not await organizer_repo.update_language(session, organizer_id, language):
            raise OrganizerNotFound()
