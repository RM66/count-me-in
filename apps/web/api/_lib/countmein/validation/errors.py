"""Validation error shape mirroring z.flattenError ({formErrors,
fieldErrors}) — never shown to users verbatim; the API responds with a
localized generic plus these details for logs/devtools.

Also holds the Zod transforms the spec cannot express (jsTrim,
lowercase) applied to raw JSON before structural validation, so bounds
see the same value Zod would have checked.
"""

from __future__ import annotations

import json
from typing import Any

# JavaScript String.prototype.trim() whitespace set, which Zod's .trim()
# calls: Unicode WhiteSpace plus line terminators plus U+FEFF, and *not*
# U+0085. The vectors pin BOM-padded input, so the exact set matters.
_JS_TRIM_CHARS = "".join(
    chr(c)
    for c in (
        set(ord(ch) for ch in "\t\n\v\f\r ")
        | {0x00A0, 0xFEFF, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000}
        | set(range(0x2000, 0x200B))
    )
)


def js_trim(v: str) -> str:
    return v.strip(_JS_TRIM_CHARS)


class Errors:
    """Mirrors z.flattenError's shape."""

    def __init__(self) -> None:
        # Initialized non-empty so JSON marshaling matches z.flattenError
        # exactly — "formErrors":[] rather than null.
        self.form: list[str] = []
        self.fields: dict[str, list[str]] = {}

    def add(self, field: str, msg: str) -> None:
        self.fields.setdefault(field, []).append(msg)

    def add_form(self, msg: str) -> None:
        self.form.append(msg)

    def empty(self) -> bool:
        return len(self.form) == 0 and len(self.fields) == 0

    def finish(self) -> Errors | None:
        """Return self, or None when no issue was collected."""
        if self.empty():
            return None
        return self


def form_errors(msg: str) -> Errors:
    e = Errors()
    e.add_form(msg)
    return e


def kind_of(raw: str) -> str:
    """Name the JSON kind of a raw value for a Zod-style message.

    str.strip() is enough here: the bytes between values in a JSON
    document are only space/tab/CR/LF (RFC 8259), a subset of both
    TrimSpace and jsTrim — unlike field values, which need the exact JS
    trim set.
    """
    s = raw.strip()
    if not s:
        return "undefined"
    c = s[0]
    if c == '"':
        return "string"
    if c == "{":
        return "object"
    if c == "[":
        return "array"
    if c in ("t", "f"):
        return "boolean"
    if c == "n":
        return "null"
    return "number"


def raw_object(body: bytes) -> tuple[dict[str, Any] | None, Errors | None]:
    """Decode the body into per-key raw values so each field can be
    attributed by name. Null, non-object and malformed bodies become form
    errors, like safeParse(null) in Zod."""
    if len(body) == 0:
        return None, form_errors("Invalid input: expected object, received null")
    try:
        m = json.loads(body)
    except ValueError:
        return None, form_errors("Invalid JSON")
    if not isinstance(m, dict):
        return None, form_errors(
            "Invalid input: expected object, received " + kind_of(body.decode("utf-8", "replace"))
        )
    return m, None


def _trim_value(raw: Any) -> Any:
    """Trim a string, or every string inside a string array (Zod's .trim()
    on option lists). Non-strings pass through unchanged."""
    if isinstance(raw, str):
        return js_trim(raw)
    if isinstance(raw, list):
        return [_trim_value(item) for item in raw]
    return raw


def trim_key(m: dict[str, Any], key: str) -> None:
    """Apply jsTrim to a string property. Absent keys are left absent —
    inserting a None entry would turn "untouched" into a validation
    failure."""
    if key not in m:
        return
    m[key] = _trim_value(m[key])


def lower_key(m: dict[str, Any], key: str) -> None:
    """Lowercase a string property (Zod .toLowerCase())."""
    v = m.get(key)
    if not isinstance(v, str):
        return
    m[key] = v.lower()
