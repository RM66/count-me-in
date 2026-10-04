"""On-demand invalidation of the Next.js Data Cache (ADR-023 Phase 3).

Public SSR reads are cached in the Next.js Data Cache under tags
(`public-organizer:{slug}`, `public-service:{id}`, `public-sitemap`)
with a 60s revalidate fallback. A committed mutation POSTs the affected
tags to the Next.js internal revalidation route, so the public page goes
stale immediately instead of at the TTL.

Fire-and-forget by contract: the caller schedules trigger_revalidation
as a response BackgroundTask — the write never waits on it, and every
failure is absorbed here (the 60s TTL is the designed fallback). A
revalidation outage must never surface as a failed mutation.

Cold-import rule: httpx arrives through web/async_client's lazy
singleton; nothing here opens a connection at module load.
"""

from __future__ import annotations

import os

from .. import logx
from ..auth.internal import INTERNAL_SECRET_HEADER, derived_internal_secret
from .async_client import client as async_client

# The Next.js-internal route — not rewritten to the Python API: the
# filesystem route wins over vercel.json's /api/internal/:path* rewrite.
REVALIDATE_PATH = "/api/internal/revalidate"

# Short budget: the task runs after the response is sent; a hung
# Next.js must fail into the TTL fallback, not hold the function open.
_HTTP_TIMEOUT = 2.0


def public_tags(
    *,
    organizer_slug: str = "",
    service_id: str = "",
    sitemap: bool = False,
) -> list[str]:
    """The Data Cache tags a mutation invalidates.

    `organizer_slug` covers the public page and every per-service page
    embedded in its slot payloads; `service_id` the standalone service
    page; `sitemap` the slug/path catalog. Empty inputs produce no tag —
    `public-organizer:` with no slug is a useless no-op.
    """
    tags: list[str] = []
    if service_id:
        tags.append(f"public-service:{service_id}")
    if organizer_slug:
        tags.append(f"public-organizer:{organizer_slug}")
    if sitemap:
        tags.append("public-sitemap")
    return tags


async def trigger_revalidation(tags: list[str]) -> None:
    """POST the tags to the Next.js revalidation route. Best-effort:
    transport errors and non-2xx answers are logged and swallowed —
    the 60s TTL covers the miss."""
    deduped = sorted(set(tags))
    if not deduped:
        return
    app_url = os.getenv("APP_URL", "").rstrip("/")
    auth_secret = os.getenv("AUTH_SECRET", "")
    if app_url == "" or auth_secret == "":
        return  # dev without APP_URL/AUTH_SECRET: the TTL fallback covers it
    headers = {
        "Content-Type": "application/json",
        INTERNAL_SECRET_HEADER: derived_internal_secret(auth_secret),
    }
    # A gated preview deployment (Vercel Authentication) answers every
    # server-side call with the SSO login page unless the automation
    # bypass header rides along; absent locally and unprotected prod.
    bypass = os.getenv("VERCEL_AUTOMATION_BYPASS_SECRET", "")
    if bypass:
        headers["x-vercel-protection-bypass"] = bypass
    try:
        res = await async_client().post(
            app_url + REVALIDATE_PATH,
            json={"tags": deduped},
            headers=headers,
            timeout=_HTTP_TIMEOUT,
        )
        if res.status_code != 200:
            logx.warn(
                "cache revalidation refused",
                {"scope": "revalidate", "status": res.status_code, "tags": deduped},
            )
    except Exception as err:
        logx.warn(
            "cache revalidation failed",
            {"scope": "revalidate", "tags": deduped, "error": str(err)},
        )
