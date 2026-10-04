"""Organizer repository: typed SQLAlchemy 2.0 queries over Organizer.

Takes an AsyncSession (the caller's transaction stays the owner) and
returns ORM instances — detached snapshots thanks to
expire_on_commit=False + lazy="raise". No text(), no string
concatenation, no row[i] unpacking.
"""

from __future__ import annotations

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.base import MessengerKind
from ..models.organizer import Organizer


async def get_by_id(session: AsyncSession, organizer_id: str) -> Organizer | None:
    result = await session.execute(select(Organizer).where(Organizer.id == organizer_id))
    return result.scalar_one_or_none()


async def get_by_slug(session: AsyncSession, slug: str) -> Organizer | None:
    result = await session.execute(select(Organizer).where(Organizer.slug == slug))
    return result.scalar_one_or_none()


async def get_by_messenger(
    session: AsyncSession, messenger: str, messenger_id: str
) -> Organizer | None:
    result = await session.execute(
        select(Organizer).where(
            Organizer.messenger == MessengerKind(messenger),
            Organizer.messenger_id == messenger_id,
        )
    )
    return result.scalar_one_or_none()


async def exists_by_messenger(session: AsyncSession, messenger: str, messenger_id: str) -> bool:
    result = await session.execute(
        select(func.count())
        .select_from(Organizer)
        .where(
            Organizer.messenger == MessengerKind(messenger),
            Organizer.messenger_id == messenger_id,
        )
    )
    return int(result.scalar_one()) > 0


async def list_public_slugs(session: AsyncSession) -> list[str]:
    """All organizer slugs for the sitemap (Phase 4 read)."""
    result = await session.execute(select(Organizer.slug).order_by(Organizer.slug))
    return list(result.scalars().all())


async def insert_organizer(
    session: AsyncSession,
    *,
    id: str,
    slug: str,
    name: str,
    messenger: str,
    messenger_id: str,
    timezone: str,
    language: str,
    description: str | None = None,
    photo_url: str | None = None,
    location: str | None = None,
    contact: str | None = None,
) -> Organizer:
    stmt = (
        pg_insert(Organizer)
        .values(
            id=id,
            slug=slug,
            name=name,
            messenger=MessengerKind(messenger),
            messenger_id=messenger_id,
            timezone=timezone,
            language=language,
            description=description,
            photo_url=photo_url,
            location=location,
            contact=contact,
        )
        .returning(Organizer)
    )
    result = await session.execute(stmt)
    return result.scalar_one()


async def get_by_id_for_update(session: AsyncSession, organizer_id: str) -> Organizer | None:
    """Organizer row under FOR UPDATE — the merge-patch read, so two
    concurrent PATCHes serialize on the row instead of merging against
    the same stale snapshot."""
    result = await session.execute(
        select(Organizer).where(Organizer.id == organizer_id).with_for_update()
    )
    return result.scalar_one_or_none()


async def update_profile(
    session: AsyncSession, organizer_id: str, values: dict[str, object]
) -> Organizer | None:
    """Merge-patch write: values are already column-keyed (touched
    only)."""
    stmt = (
        update(Organizer).where(Organizer.id == organizer_id).values(**values).returning(Organizer)
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def update_language(session: AsyncSession, organizer_id: str, language: str) -> bool:
    result = await session.execute(
        update(Organizer).where(Organizer.id == organizer_id).values(language=language)
    )
    return int(getattr(result, "rowcount", 0) or 0) > 0


async def upsert_demo_organizer(
    session: AsyncSession,
    *,
    id: str,
    slug: str,
    name: str,
    messenger_id: str,
    timezone: str,
    language: str,
    description: str | None,
    photo_url: str | None,
    location: str | None,
    contact: str | None,
) -> None:
    stmt = pg_insert(Organizer).values(
        id=id,
        slug=slug,
        name=name,
        messenger=MessengerKind.TELEGRAM,
        messenger_id=messenger_id,
        timezone=timezone,
        language=language,
        description=description,
        photo_url=photo_url,
        location=location,
        contact=contact,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["id"],
        set_={
            "slug": stmt.excluded.slug,
            "name": stmt.excluded.name,
            "timezone": stmt.excluded.timezone,
            "language": stmt.excluded.language,
            "description": stmt.excluded.description,
            "photo_url": stmt.excluded.photo_url,
            "location": stmt.excluded.location,
            "contact": stmt.excluded.contact,
        },
    )
    await session.execute(stmt)
