"""Post-commit media cleanup — the R2 delete behind a replaced or
deleted photoUrl. Best-effort by design (ADR-012): a storage failure
must never fail an already-committed request."""

from __future__ import annotations

import asyncio

from .. import logx, storage
from ..db.client import sessionmaker
from ..services.media_service import photo_url_referenced

# Caps the post-response R2 work — it runs inline after the commit, so
# it must not hold the function open (maxDuration is 10s in
# vercel.json).
_MEDIA_CLEANUP_TIMEOUT = 3.0


async def cleanup_replaced_media(organizer_id: str, old_url: str, new_url: str) -> None:
    """Remove the object behind old_url after its row committed a new
    value (or was deleted). Best-effort, like the notification publisher
    (ADR-012): a storage failure must not fail an already-committed
    request, so failures are logged and swallowed. The work runs on a
    detached timeout — the response is already written, and a client
    disconnect must not orphan the old object.

    The reference check exists because is_own_media_url validates only
    the organizer's prefix, not uniqueness: one object can back the
    avatar and a cover, or two covers, so the delete is skipped while
    any row still points at old_url.

    The boto3 delete is blocking, so it runs in a worker thread INSIDE
    the timeout — asyncio.timeout cannot cancel a thread, so the
    botocore client carries its own connect/read timeouts and a single
    attempt to guarantee the thread finishes on its own."""
    if old_url == "" or old_url == new_url:
        return
    try:
        async with asyncio.timeout(_MEDIA_CLEANUP_TIMEOUT):
            async with sessionmaker()() as session:
                referenced = await photo_url_referenced(session, organizer_id, old_url)
            if referenced:
                logx.info(
                    "skipped media cleanup",
                    {"organizerId": organizer_id, "reason": "still-referenced"},
                )
                return
            await asyncio.to_thread(storage.delete_replaced_media, organizer_id, old_url, new_url)
    except Exception as err:
        logx.error(err, {"organizerId": organizer_id, "op": "media-reference-check"})
