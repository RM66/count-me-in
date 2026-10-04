"""Cabinet organizer resolution (ADR-010)."""

from __future__ import annotations

from ..auth.session import Session
from ..contracts.constants_gen import DEMO_ORGANIZER_ID
from .guard import is_demo_organizer


def resolve_cabinet_organizer_id(session: Session | None) -> tuple[str, bool]:
    """The organizer the cabinet shows for this request: the signed-in
    organizer, or the demo organizer with no session. is_demo travels
    with the id so callers never re-derive it."""
    if session is not None:
        return session.organizer_id, is_demo_organizer(session.organizer_id)
    return DEMO_ORGANIZER_ID, True
