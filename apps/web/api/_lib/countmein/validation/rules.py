"""Hand-written validation rules: everything the OpenAPI spec cannot
express (ADR-016). Bounds, enums, patterns (uuid, serviceId, slug shape)
and required-ness come from the generated Pydantic models; these are the
leftovers. Pinned by packages/contracts/vectors/validation/*.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ..contracts.constants_gen import SLOT_START_TOLERANCE_MS

# Reserved slugs (ADR-009): path segments the public booking page can
# never be served from. The slug *shape* is a spec pattern;
# reserved-ness is a policy only the code knows.
RESERVED_SLUGS = {
    "api",
    "booking",
    "cabinet",
    "signup",
    "login",
    "terms",
    "privacy",
    "demo",
}


def is_reserved_slug(v: str) -> bool:
    """Path segments the public booking page can never be served from
    (including "demo")."""
    return v.lower() in RESERVED_SLUGS


def _is_valid_timezone(v: str) -> bool:
    """Mirror Intl.DateTimeFormat's case-insensitive lookup: exact id,
    then a re-cased form ("europe/belgrade" → "Europe/Belgrade").
    "Local" is rejected so both sides accept the same set."""
    if v == "" or v.lower() == "local":
        return False
    try:
        ZoneInfo(v)
        return True
    except (ZoneInfoNotFoundError, ValueError):
        pass
    try:
        ZoneInfo(_canonicalize_timezone(v))
        return True
    except (ZoneInfoNotFoundError, ValueError):
        return False


def _canonicalize_timezone(v: str) -> str:
    """Restore conventional IANA casing: upper-case the first letter of
    every slash- and underscore-separated segment."""
    segments = []
    for segment in v.split("/"):
        parts = []
        for part in segment.split("_"):
            if part == "":
                parts.append(part)
                continue
            parts.append(part[0].upper() + part[1:].lower())
        segments.append("_".join(parts))
    return "/".join(segments)


def timezone_rule(v: str) -> str:
    if not _is_valid_timezone(v):
        return "Invalid IANA timezone"
    return ""


def valid_url(v: str) -> bool:
    try:
        parts = urlsplit(v)
    except ValueError:
        return False
    # http/https only: the value renders as a link — other schemes
    # (javascript:, data:, mailto:) are dangerous or not web links.
    if parts.scheme not in ("http", "https"):
        return False
    return parts.netloc != ""


def url_rule(v: str) -> str:
    """The spec carries only `format: uri`, which the models do not
    enforce; the shape check stays here."""
    if not valid_url(v):
        return "Invalid input: expected URL"
    return ""


def is_acceptable_slot_start(starts_at: datetime) -> bool:
    return starts_at > datetime.now(UTC) - timedelta(milliseconds=SLOT_START_TOLERANCE_MS)
