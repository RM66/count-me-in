"""PhotoURLReferenced: whether any organizer or service row still
carries url as its photo_url. Gates the R2 cleanup that follows a
replace/delete: the ownership check (storage.is_own_media_url) validates
only the organizer's prefix, not uniqueness, so one object can legally
back the avatar and a cover, or two covers — deleting it while another
row still serves it would break that row's image.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection


async def photo_url_referenced(conn: AsyncConnection, organizer_id: str, url: str) -> bool:
    result = await conn.execute(
        text(
            """
            SELECT EXISTS (
                SELECT 1 FROM organizers WHERE id = :org_id AND photo_url = :url
                UNION ALL
                SELECT 1 FROM services WHERE organizer_id = :org_id AND photo_url = :url
            )
            """
        ),
        {"org_id": organizer_id, "url": url},
    )
    row = result.first()
    return bool(row[0]) if row is not None else False
