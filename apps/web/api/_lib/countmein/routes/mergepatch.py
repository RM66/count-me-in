"""JSON Merge Patch (RFC 7386) plumbing for the three partial-update
endpoints (ADR-016, Phase 4). The patch semantics — absent key = keep,
explicit null = clear — come from the media type itself: the handler
merges the patch into the current wire state, validates the *result*
(bounds apply to the final state, which is stricter than validating the
patch alone), and hands the service layer the touched columns only.

apply_merge_patch is the one transactional skeleton the three PATCH
handlers share: patch_keys → one transaction → fetch current *under
FOR UPDATE* → merge → decode the merged state → column-keyed values →
update. The per-entity pieces are the field table (wire key → column +
conversions) below plus the caller's fetch/decode/update closures; the
not-found mapping stays the caller's (fetch raises it), so the generic
body owns only the order and the transaction.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any, NamedTuple

from sqlalchemy.ext.asyncio import AsyncSession

from ..contracts.domain import iso_date, parse_flex_time
from ..errors import InvalidInput, NothingToUpdate


def patch_keys(body: bytes) -> frozenset[str] | None:
    """The top-level keys in a merge-patch body — the columns the client
    meant to change. None for a non-object or empty patch (the
    "nothing to update" 400)."""
    try:
        patch = json.loads(body)
    except ValueError:
        return None
    if not isinstance(patch, dict) or not patch:
        return None
    return frozenset(patch)


def merge_patch(current_state: dict[str, Any], patch_body: bytes) -> bytes:
    """Apply RFC 7386 to the current wire state — a map of the entity's
    writable fields (None values merge like absent keys for nullable
    columns)."""
    try:
        patch = json.loads(patch_body)
    except ValueError as err:
        raise ValueError("invalid merge patch") from err
    merged = _merge(current_state, patch)
    return json.dumps(merged).encode()


def _merge(current: Any, patch: Any) -> Any:
    """The RFC 7386 merge algorithm (the jsonpatch.MergePatch port),
    applied to parsed values: a non-dict patch replaces the target
    wholesale, a null patch member deletes the key."""
    if not isinstance(patch, dict):
        return patch
    if not isinstance(current, dict):
        current = {}
    result = dict(current)
    for key, value in patch.items():
        if value is None:
            result.pop(key, None)
        else:
            result[key] = _merge(result.get(key), value)
    return result


def _passthrough(v: Any) -> Any:
    return v


def _opt_str(v: Any) -> str | None:
    return str(v) if v is not None else None


def _opt_list(v: Any) -> list[Any] | None:
    return list(v) if v is not None else None


class FieldMap(NamedTuple):
    """One writable wire key: the column it lives in, how the row reads
    back as wire JSON (the merge base), and how the merged-state value
    becomes a column value. Non-nullable conversions (str/int) are safe
    on touched keys — the merged decoder rejects their nulls."""

    column: str
    to_wire: Callable[[Any], Any] = _passthrough
    to_column: Callable[[Any], Any] = _passthrough


# The three field tables — wire key → (column, row→wire, state→column).
# The merge base, the touched-column set and the update values all come
# from the same table, so a wire typo cannot silently drop a column.
ORGANIZER_FIELDS: dict[str, FieldMap] = {
    "name": FieldMap("name", to_column=str),
    "slug": FieldMap("slug", to_column=str),
    "timezone": FieldMap("timezone", to_column=str),
    "description": FieldMap("description", to_column=_opt_str),
    "location": FieldMap("location", to_column=_opt_str),
    "contact": FieldMap("contact", to_column=_opt_str),
    "photoUrl": FieldMap("photo_url", to_column=_opt_str),
}

SERVICE_FIELDS: dict[str, FieldMap] = {
    "title": FieldMap("title", to_column=str),
    "description": FieldMap("description", to_column=_opt_str),
    "location": FieldMap("location", to_column=_opt_str),
    "contact": FieldMap("contact", to_column=_opt_str),
    "defaultPrice": FieldMap("default_price", to_column=str),
    "defaultCapacity": FieldMap("default_capacity", to_column=int),
    "defaultDurationMinutes": FieldMap("default_duration_minutes", to_column=int),
    "maxSeatsPerBooking": FieldMap("max_seats_per_booking", to_column=int),
    "options": FieldMap("options", to_column=_opt_list),
    "optionsSelectMode": FieldMap("options_select_mode", to_column=_opt_str),
    "photoUrl": FieldMap("photo_url", to_column=_opt_str),
}

SLOT_FIELDS: dict[str, FieldMap] = {
    # A patch may replace startsAt with an epoch number — the wire base
    # is the ISO rendering, the column value the parsed instant.
    "startsAt": FieldMap("starts_at", to_wire=iso_date, to_column=parse_flex_time),
    "durationMinutes": FieldMap("duration_minutes", to_column=int),
    "capacity": FieldMap("capacity", to_column=int),
    "price": FieldMap("price", to_column=_opt_str),
}


async def apply_merge_patch[RowT, StateT](
    session: AsyncSession,
    raw: bytes,
    *,
    fetch: Callable[[AsyncSession], Awaitable[RowT]],
    fields: dict[str, FieldMap],
    decode_merged: Callable[[bytes, frozenset[str]], StateT],
    update_tx: Callable[[AsyncSession, RowT, dict[str, Any]], Awaitable[RowT]],
) -> tuple[RowT, dict[str, Any], frozenset[str]]:
    """The shared merge-patch transaction: locked read → merge → write
    on one ORM transaction over the caller's session. fetch MUST read
    the row with FOR UPDATE — under READ COMMITTED a plain SELECT takes
    no lock, and two concurrent PATCHes would merge against the same
    snapshot and produce cross-field states neither patch wrote. The
    fetch and update callbacks raise the entity's not-found themselves;
    decode_merged receives the touched-key set (the slot decoder checks
    startsAt only when the patch touched it).

    Returns (row, previous, touched) for the response and the
    after-commit follow-ups. `previous` is the column values captured
    BEFORE update_tx — not `current`: the UPDATE … RETURNING writes the
    new values into the same identity-map object, so post-commit the
    fetched row already reads as updated and an old-vs-new comparison
    against it is always false."""
    keys = patch_keys(raw)
    if keys is None:
        raise NothingToUpdate()
    touched = keys & fields.keys()
    if not touched:
        raise NothingToUpdate()
    async with session.begin():
        current = await fetch(session)
        base = {key: f.to_wire(getattr(current, f.column)) for key, f in fields.items()}
        try:
            merged = merge_patch(base, raw)
        except ValueError:
            raise InvalidInput() from None
        state = decode_merged(merged, touched)
        values = {
            f.column: f.to_column(getattr(state, key, None))
            for key, f in fields.items()
            if key in touched
        }
        previous = {f.column: getattr(current, f.column) for f in fields.values()}
        row = await update_tx(session, current, values)
    return row, previous, touched
