"""JSON Merge Patch (RFC 7386) plumbing for the three partial-update
endpoints (ADR-016, Phase 4). The patch semantics — absent key = keep,
explicit null = clear — come from the media type itself: the handler
merges the patch into the current wire state, validates the *result*
(bounds apply to the final state, which is stricter than validating the
patch alone), and hands the db layer the merged state plus the set of
touched keys so only intended columns are written.

apply_merge_patch is the one transactional skeleton the three PUT
handlers share: patch_keys → one transaction → fetch current → merge →
decode the merged state → update_tx. The per-entity pieces (fetch,
writable-state projection, merged decoder, update) are passed in; the
not-found mapping stays the caller's (fetch/update raise it), so the
generic body owns only the order and the transaction."""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..db.client import sessionmaker
from ..db.shared import TouchedUpdate
from ..errors import InvalidInput, NothingToUpdate


def patch_keys(body: bytes) -> dict[str, bool] | None:
    """The top-level keys present in a merge-patch body — the columns
    the client meant to change. None for a non-object or empty patch:
    an empty patch is the "nothing to update" 400, exactly like the old
    Optional[T] flow answered it."""
    try:
        patch = json.loads(body)
    except ValueError:
        return None
    if not isinstance(patch, dict) or not patch:
        return None
    return {k: True for k in patch}


def merge_patch(current_state: dict[str, Any], patch_body: bytes) -> bytes:
    """Apply RFC 7386 to the current wire state. current_state is a map
    of the entity's writable fields (values may be None — nulls merge
    the same way absent keys do for nullable columns)."""
    current_json = json.dumps(current_state)
    try:
        patch = json.loads(patch_body)
    except ValueError as err:
        raise ValueError("invalid merge patch") from err
    merged = _merge(current_json, patch)
    return json.dumps(merged).encode()


def _merge(current_json: str, patch: Any) -> Any:
    """The RFC 7386 merge algorithm (the jsonpatch.MergePatch port)."""
    import json as _json

    try:
        current = _json.loads(current_json)
    except ValueError:
        current = None
    if not isinstance(patch, dict):
        return patch
    if not isinstance(current, dict):
        current = {}
    result = dict(current)
    for key, value in patch.items():
        if value is None:
            result.pop(key, None)
        else:
            result[key] = _merge(_json.dumps(result.get(key)), value)
    return result


async def apply_merge_patch[RowT, StateT](
    raw: bytes,
    *,
    fetch: Callable[[AsyncSession], Awaitable[RowT]],
    writable_state: Callable[[RowT], dict[str, Any]],
    decode_merged: Callable[[bytes, dict[str, bool]], StateT],
    update_tx: Callable[[AsyncSession, StateT, dict[str, bool]], Awaitable[RowT]],
) -> tuple[RowT, RowT, dict[str, bool]]:
    """The shared merge-patch transaction: read → merge → write on one
    ORM session transaction (two concurrent PUTs must not merge against
    different snapshots and silently lose columns). fetch and update_tx
    raise the entity's not-found error themselves; decode_merged
    receives the touched-key set alongside the merged bytes (the slot
    decoder checks startsAt only when the patch touched it). Returns
    (row, current, touched) so the caller can build the response and
    the replaced-media cleanup."""
    touched = patch_keys(raw)
    if touched is None:
        raise NothingToUpdate()
    async with sessionmaker()() as session, session.begin():
        current = await fetch(session)
        try:
            merged = merge_patch(writable_state(current), raw)
        except ValueError:
            raise InvalidInput() from None
        state = decode_merged(merged, touched)
        row = await update_tx(session, state, touched)
    return row, current, touched


def touched_update[StateT](state: StateT, touched: dict[str, bool]) -> TouchedUpdate[StateT]:
    """Build the db layer's update contract — a thin alias so route
    call sites read as one expression."""
    return TouchedUpdate(state=state, touched=touched)
