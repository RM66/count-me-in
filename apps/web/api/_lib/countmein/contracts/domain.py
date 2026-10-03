"""Hand-written domain logic: mirrors TypeScript in packages/contracts/src
that cannot be derived from the OpenAPI spec (ADR-016). Pinned by
packages/contracts/vectors/domain/* (vitest + pytest).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from .constants_gen import (
    DEFAULT_LOCALE,
    DEMO_ORGANIZER_ID,
    LOCALES,
    LOGIN_LINK_KEY_PREFIX,
)

# Re-exported for callers that reach the default through the domain
# module (jobs templates, tests) — the value itself is generated.
__all__ = ["DEFAULT_LOCALE"]

# OptionsSelectMode values (mirror of the generated enum).
SELECT_MODE_SINGLE = "single"
SELECT_MODE_MULTI = "multi"

# NotificationRecipient values.
RECIPIENT_ORGANIZER = "organizer"
RECIPIENT_GUEST = "guest"


def is_app_locale(v: str) -> bool:
    return v in LOCALES


def is_demo_organizer_id(organizer_id: str) -> bool:
    # str() normalizes a UUID object that slipped past the row mappers —
    # a raw UUID == str comparison is always False (ADR-010).
    return str(organizer_id) == DEMO_ORGANIZER_ID


def cancel_notification_recipient(by: str) -> str:
    if by == "guest":
        return RECIPIENT_ORGANIZER
    return RECIPIENT_GUEST


def login_link_key(token: str) -> str:
    return LOGIN_LINK_KEY_PREFIX + token


def seats_left(capacity: int, booked_count: int) -> int:
    """Remaining seats, floored at zero."""
    left = capacity - booked_count
    return left if left > 0 else 0


def slot_price(slot_price: str | None, service_default_price: str) -> str:
    """A slot's own price override, else the service default."""
    if slot_price is not None:
        return slot_price
    return service_default_price


def effective_location(service: str | None, organizer: str | None) -> str | None:
    """A service may override its organizer's location."""
    if service is not None:
        return service
    return organizer


def effective_contact(service: str | None, organizer: str | None) -> str | None:
    """Same inheritance rule as location."""
    if service is not None:
        return service
    return organizer


def validate_selected_options(
    service_options: list[str], select_mode: str, selected: list[str]
) -> list[str] | None:
    """Check a booking's selectedOptions against a concrete service.

    Mirror of buildSelectedOptionsSchema in packages/contracts/src/options.ts
    — error strings are intentionally identical; parity is pinned by the
    validateSelectedOptions domain vectors. Returns None on success, or
    raises ValueError with the mirrored message.
    """
    allowed = set(service_options)
    if not allowed:
        if selected:
            raise ValueError("this service has no options to select")
        return None
    seen: set[str] = set()
    for v in selected:
        if v in seen:
            raise ValueError("selectedOptions must not contain duplicates")
        seen.add(v)
    for v in selected:
        if v not in allowed:
            raise ValueError(f"option {v!r} is not offered by this service")
    if select_mode == SELECT_MODE_SINGLE and len(selected) > 1:
        raise ValueError("this service allows selecting only one option")
    if not selected:
        return None
    return selected


def match_locale(accept_language: str) -> str | None:
    """Find the first supported locale in an Accept-Language string.

    Mirror of matchLocale in packages/contracts/src/i18n.ts (RFC 9110:
    absent or malformed q means 1, q=0 is unacceptable, higher q first,
    list order breaks ties via stable sort). Parity pinned by the
    matchLocale domain vectors.
    """
    if accept_language == "":
        return None

    weighted: list[tuple[str, float]] = []
    for part in accept_language.split(","):
        segments = part.split(";", 1)
        tag = segments[0].strip().lower()
        q = 1.0
        if len(segments) == 2:
            for param in segments[1].split(";"):
                v = _parse_q_param(param.strip())
                if v is not None:
                    q = v
                    break  # first q= wins, mirroring TS params.find
        if q > 0:
            weighted.append((tag, q))

    # Stable sort by descending q — list order breaks ties.
    weighted.sort(key=lambda e: -e[1])

    for tag, _q in weighted:
        if tag == "":
            continue
        if tag in LOCALES:
            return tag
        for locale in LOCALES:
            if tag.startswith(locale + "-"):
                return locale
    return None


def _parse_q_param(q_param: str) -> float | None:
    if not q_param.startswith("q="):
        return None
    # Mirror JS Number.parseFloat prefix semantics (matchLocale in
    # contracts/src/i18n.ts): "0.9abc" parses as 0.9; a non-numeric
    # suffix means absent (caller keeps q=1).
    raw = q_param[2:].strip()
    end = 0
    while end < len(raw):
        c = raw[end]
        if c.isdigit() or c in ".+-eE":
            end += 1
            continue
        break
    if end == 0:
        return None
    try:
        return float(raw[:end])
    except ValueError:
        return None


# ── Wall-clock ↔ instant (ADR: wall-clock time is a contract) ────────────────


def wall_clock_to_instant(date_str: str, time_str: str, tz_name: str) -> datetime:
    """Interpret a wall-clock date+time in the organizer's timezone as a
    UTC instant. Mirrors wallClockToInstant in packages/contracts/src/timezone.ts."""
    tz = ZoneInfo(tz_name)
    naive = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
    return naive.replace(tzinfo=tz).astimezone(UTC)


def instant_to_wall_clock_inputs(instant: datetime, tz_name: str) -> tuple[str, str]:
    """Render a UTC instant as (date, time) wall-clock strings in the
    organizer's timezone. Mirrors instantToWallClockInputs."""
    tz = ZoneInfo(tz_name)
    local = instant.astimezone(tz)
    return local.strftime("%Y-%m-%d"), local.strftime("%H:%M")


def slot_end(starts_at: datetime, duration_minutes: int) -> datetime:
    return starts_at + timedelta(minutes=duration_minutes)


# ── FlexTime: RFC3339 string or Unix epoch (seconds or milliseconds) ────────


def parse_flex_time(value: str | int | float) -> datetime:
    """Accept an RFC3339 string or a Unix epoch number (seconds or
    milliseconds). A deliberate tightening over Zod's z.coerce.date(),
    which accepts anything new Date() parses. Safe for the wire: the
    only writer of startsAt is the cabinet slot form, which folds
    date+time through wall_clock_to_instant into a full ISO string.
    Formats new Date() parses as *local* time (date-only, no-zone
    datetime) are rejected rather than guessed — server-local semantics
    would be worse than a 400."""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            raise ValueError("date string")
        return value.astimezone(UTC)
    if isinstance(value, str):
        s = value.strip()
        # RFC3339 requires an offset; fromisoformat handles Z since 3.11.
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError as err:
            raise ValueError("date string") from err
        if dt.tzinfo is None:
            raise ValueError("date string")
        return dt.astimezone(UTC)
    if isinstance(value, bool):
        raise ValueError("date string")
    if isinstance(value, (int, float)):
        # > 1e12 means milliseconds, else seconds.
        ms = float(value)
        if value <= 1e12:
            ms = value * 1000
        return datetime.fromtimestamp(int(ms) / 1000, tz=UTC)
    raise ValueError("date string")


def iso_date(t: datetime | None) -> str:
    """Render t like JS Date.toISOString(): always UTC, always
    millisecond precision. None is accepted for the mappers' optional
    columns — the schema columns are NOT NULL, so a real None is a bug
    and raises (python -O must not strip the check)."""
    if t is None:
        raise RuntimeError("iso_date: None datetime")
    return (
        t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.")
        + f"{t.astimezone(UTC).microsecond // 1000:03d}Z"
    )


def deref_or(p: Any, default: Any) -> Any:
    """The value behind an optional, or the default when None."""
    if p is None:
        return default
    return p
