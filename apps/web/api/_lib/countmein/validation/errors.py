"""Validation error shape mirroring z.flattenError ({formErrors,
fieldErrors}) — never shown to users verbatim; the API responds with a
localized generic plus these details for logs/devtools.
"""

from __future__ import annotations


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
