"""Server-side reads, writes and DTO mapping for organizers. Two
projections, one table: OrganizerProfile is the organizer's own view,
PublicOrganizer the one guests get — keeping them as separate mappers
stops the messenger identity from leaking to a public page.

Every write is owner-scoped; the demo guard runs inside every write
(defense in depth — routes already refuse the demo account).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from .. import storage
from ..contracts import domain
from ..contracts import models_gen as gen
from ..contracts.payloads import AuthTicketPayload
from ..demo import refuse_demo_write
from ..errors import NothingToUpdate, OrganizerNotFound, PhotoPrefix
from .client import engine
from .rows import ORGANIZER_COLUMNS, OrganizerRow, scan_organizer
from .shared import TouchedUpdate, new_id


async def get_organizer_profile(organizer_id: str) -> OrganizerRow | None:
    async with engine().connect() as conn:
        return await get_organizer_profile_tx(conn, organizer_id)


async def get_organizer_profile_tx(conn: AsyncConnection, organizer_id: str) -> OrganizerRow | None:
    """The profile for the organizer this request may view; None when the
    id does not exist (e.g. demo not yet seeded). The merge-patch route
    reads the current state and writes the merged state on one
    transaction so concurrent PUTs cannot lose columns."""
    result = await conn.execute(
        text(f"SELECT {ORGANIZER_COLUMNS} FROM organizers WHERE id = :id"),
        {"id": organizer_id},
    )
    return scan_organizer(result.first())


async def exists_organizer_by_messenger(messenger: str, messenger_id: str) -> bool:
    """Used by the signup flow to decide sign-in vs registration."""
    async with engine().connect() as conn:
        result = await conn.execute(
            text("SELECT 1 FROM organizers WHERE messenger = :messenger AND messenger_id = :mid"),
            {"messenger": messenger, "mid": messenger_id},
        )
        return result.first() is not None


async def insert_organizer(
    payload: gen.RegisterOrganizerInput, identity: AuthTicketPayload
) -> gen.RegisteredOrganizer:
    """Register an organizer; the messenger identity comes from the
    peeked ticket (validated server-side), never from the body. A 23505
    surfaces as the raw driver error for the route to map to
    slugTaken / accountExists by constraint name."""
    # The wire schema makes language required, but a None here must
    # never crash the function — fall back to the default locale.
    # (--use-type-alias renders scalar schemas as plain Annotated
    # types, so no RootModel unwrapping is needed before SQL.)
    language = domain.deref_or(payload.language, domain.DEFAULT_LOCALE)
    async with engine().begin() as conn:
        result = await conn.execute(
            text(
                """
                INSERT INTO organizers
                    (id, slug, name, messenger, messenger_id, timezone, language, contact, photo_url)
                VALUES (:id, :slug, :name, :messenger, :mid, :tz, :lang, :contact, :photo)
                RETURNING id, slug
                """
            ),
            {
                "id": new_id(),
                "slug": str(payload.slug),
                "name": str(payload.name),
                "messenger": identity.messenger,
                "mid": identity.messenger_id,
                "tz": str(payload.timezone),
                "lang": language,
                "contact": payload.contact,
                "photo": identity.photo_url,
            },
        )
        row = result.first()
    # model_construct (not model_validate): the generated UUID pattern
    # constraint cannot be applied by pydantic-core (TypeError), and the
    # id comes straight from the database. str(): psycopg hands back a
    # UUID object; the root must hold the canonical string or every
    # response marshal trips pydantic's serializer.
    return gen.RegisteredOrganizer.model_construct(id=str(row[0]), slug=row[1])  # type: ignore[index]


async def update_organizer_profile_tx(
    conn: AsyncConnection, organizer_id: str, update: TouchedUpdate[gen.UpdateOrganizerProfileInput]
) -> OrganizerRow | None:
    """Editable fields only; messenger identity, id and createdAt are set
    at registration and never editable. Absent keys are left untouched,
    explicit nulls clear the column (merge-patch semantics, ADR-016).

    Defense in depth: routes already refuse the demo account via
    require_writable_organizer, but a direct db call must not be able to
    write the read-only demo organizer either. The media-ownership
    invariant lives here too — a touched photoUrl must stay under this
    organizer's media prefix, checked inside the transaction before any
    column is written."""
    refuse_demo_write(organizer_id)
    state = update.state
    touched = update.touched
    if touched.get("photoUrl") and state.photoUrl is not None:
        if not storage.is_own_media_url(organizer_id, str(state.photoUrl)):
            raise PhotoPrefix()
    sets: list[str] = []
    args: dict[str, Any] = {"org_id": organizer_id}

    def add(col: str, key: str, value: Any) -> None:
        sets.append(f"{col} = :{key}")
        args[key] = value

    if touched.get("name") and state.name is not None:
        add("name", "name", str(state.name))
    if touched.get("slug") and state.slug is not None:
        add("slug", "slug", str(state.slug))
    if touched.get("timezone") and state.timezone is not None:
        add("timezone", "timezone", str(state.timezone))
    if touched.get("description"):
        if state.description is not None:
            add("description", "description", str(state.description))
        else:
            sets.append("description = NULL")
    if touched.get("location"):
        if state.location is not None:
            add("location", "location", str(state.location))
        else:
            sets.append("location = NULL")
    if touched.get("contact"):
        if state.contact is not None:
            add("contact", "contact", str(state.contact))
        else:
            sets.append("contact = NULL")
    if touched.get("photoUrl"):
        if state.photoUrl is not None:
            add("photo_url", "photo_url", str(state.photoUrl))
        else:
            sets.append("photo_url = NULL")
    if not sets:
        raise NothingToUpdate()

    query = (
        f"UPDATE organizers SET {', '.join(sets)} WHERE id = :org_id RETURNING {ORGANIZER_COLUMNS}"
    )
    result = await conn.execute(text(query), args)
    return scan_organizer(result.first())


async def update_organizer_language(organizer_id: str, language: str) -> None:
    """Set the organizer's notification language (ADR-011). An unknown
    id (0 rows affected) is an OrganizerNotFound so a stale session
    answers 404 instead of a silent success."""
    refuse_demo_write(organizer_id)
    async with engine().begin() as conn:
        result = await conn.execute(
            text("UPDATE organizers SET language = :lang WHERE id = :id"),
            {"lang": language, "id": organizer_id},
        )
        if result.rowcount == 0:
            raise OrganizerNotFound()
