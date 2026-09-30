"""Media repository: the photo_url uniqueness probe behind R2 cleanup."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.organizer import Organizer
from ..models.service import Service


async def photo_url_referenced(session: AsyncSession, organizer_id: str, url: str) -> bool:
    """Whether any organizer/service row still serves url — guards the
    post-commit R2 delete (one object can legally back two rows)."""
    avatar_used = select(Organizer.id).where(
        Organizer.id == organizer_id, Organizer.photo_url == url
    )
    cover_used = select(Service.id).where(
        Service.organizer_id == organizer_id, Service.photo_url == url
    )
    result = await session.execute(
        select(avatar_used.exists().label("avatar"), cover_used.exists().label("cover"))
    )
    row = result.one()
    return bool(row.avatar or row.cover)
