"""JSON Merge Patch (RFC 7386) plumbing for the three partial-update
endpoints (ADR-016, Phase 4). The patch semantics — absent key = keep,
explicit null = clear — come from the media type itself: the handler
merges the patch into the current wire state, validates the *result*
(bounds apply to the final state, which is stricter than validating the
patch alone), and hands the db layer the merged state plus the set of
touched keys so only intended columns are written."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from starlette.requests import Request

if TYPE_CHECKING:
    pass

from ..httpx_.response import Response, error


def require_merge_patch_content_type(request: Request, locale: str) -> Response | None:
    """Answer 415 unless the request declares the RFC 7386 media type.
    The semantics (absent key = keep, explicit null = clear) belong to
    the media type, not the body: a client sending application/json to a
    PUT that only speaks merge-patch would silently get partial-update
    behavior where it expected replace."""
    ct = request.headers.get("content-type", "")
    if ct == "" or ct.split(";", 1)[0].strip() != "application/merge-patch+json":
        return error(415, locale, "unsupportedMediaType")
    return None


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
