"""The API's JSON encoding: stdlib `json.dumps` with compact
separators and `ensure_ascii=False` — the deliberate wire format
recorded in ADR-021 ("Retired Go byte-emulation"). Key order is the
model's field order (dicts preserve insertion order); no HTML escaping,
no trailing newline.
"""

from __future__ import annotations

import json
from typing import Any


def dumps_compact(value: Any) -> str:
    """Encode value as compact JSON (no spaces, UTF-8 text)."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
