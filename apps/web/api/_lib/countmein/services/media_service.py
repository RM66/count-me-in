"""PhotoURLReferenced: whether any organizer or service row still
carries url as its photo_url. Gates the R2 cleanup that follows a
replace/delete: the ownership check (storage.is_own_media_url) validates
only the organizer's prefix, not uniqueness, so one object can legally
back the avatar and a cover, or two covers — deleting it while another
row still serves it would break that row's image.

A leaf query, not a unit of work: the caller (post-commit cleanup)
manages its own session/connection.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from ..repositories import media_repo


async def photo_url_referenced(session: AsyncSession, organizer_id: str, url: str) -> bool:
    return await media_repo.photo_url_referenced(session, organizer_id, url)
