"""Organizer service — profile writes.

Two projections exist downstream of this module (OrganizerProfile for
the owner, PublicOrganizer for guests) — they live in db/serializers.py
so the messenger identity cannot leak to a public page through this
boundary. Reads with no business rule live in organizer_repo — routes
call it directly.

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
from ..db.shared import new_id
from ..demo import refuse_demo_write
from ..errors import OrganizerNotFound, PhotoPrefix
from ..models.organizer import Organizer
from ..repositories import organizer_repo


async def insert_organizer(
    session: AsyncSession,
    payload: gen.RegisterOrganizerInput,
    identity: AuthTicketPayload,
) -> Organizer:
    """Register an organizer; the messenger identity comes from the
    peeked ticket (validated server-side), never from the body. A 23505
    surfaces as the raw driver error for the route to map to
    slugTaken / accountExists by constraint name."""
    # language is required by the wire schema, but a None must not crash
    # — fall back to the default locale.
    language = str(payload.language or domain.DEFAULT_LOCALE)
    async with session.begin():
        return await organizer_repo.insert_organizer(
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


async def update_organizer_profile(
    session: AsyncSession,
    organizer_id: str,
    values: dict[str, Any],
) -> Organizer | None:
    """Merge-patch write of already column-keyed values (absent keys
    untouched, explicit nulls cleared by the caller — ADR-016). Editable
    fields only; messenger identity, id and createdAt are set at
    registration. Runs on the caller's transaction.

    Defense in depth: routes already refuse the demo account, but a
    direct service call must not write it either. The media-ownership
    invariant lives here too — a touched photoUrl must stay under this
    organizer's media prefix, checked in the tx before any write."""
    refuse_demo_write(organizer_id)
    photo_url = values.get("photo_url")
    if photo_url is not None and not storage.is_own_media_url(organizer_id, str(photo_url)):
        raise PhotoPrefix()
    return await organizer_repo.update_profile(session, organizer_id, values)


async def update_organizer_language(
    session: AsyncSession, organizer_id: str, language: str
) -> None:
    """Set the organizer's notification language (ADR-011). An unknown
    id is OrganizerNotFound, so a stale session answers 404 instead of
    a silent success."""
    refuse_demo_write(organizer_id)
    async with session.begin():
        if not await organizer_repo.update_language(session, organizer_id, language):
            raise OrganizerNotFound()
