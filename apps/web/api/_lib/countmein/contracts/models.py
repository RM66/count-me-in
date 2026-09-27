"""Hand-written helpers over the generated Pydantic models.

`unwrap_root` is the single copy of the RootModel unwrapping loop that
eleven modules used to duplicate: generated scalar fields (slug,
timezone, photoUrl, option labels, startsAt) arrive as RootModel
wrappers, sometimes nested (an OptionsList's items are themselves
OptionLabel RootModels), and every consumer wants the plain value.
"""

from __future__ import annotations

from typing import Any


def unwrap_root(value: Any) -> Any:
    """Unwrap RootModel values recursively and return the plain value."""
    while hasattr(value, "root"):
        value = value.root
    return value
