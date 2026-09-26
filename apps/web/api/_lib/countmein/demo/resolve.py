"""Cabinet organizer resolution (ADR-010)."""

from __future__ import annotations

from starlette.requests import Request

from ..auth.session import session_from_request
from ..contracts.constants_gen import DEMO_ORGANIZER_ID
from .guard import is_demo_organizer


def resolve_cabinet_organizer_id(request: Request) -> tuple[str, bool]:
    """The organizer whose data the cabinet should show for this
    request: the signed-in organizer, or the demo organizer when there
    is no session. is_demo travels with the id so callers never
    re-derive it."""
    s = session_from_request(request)
    if s is not None:
        return s.organizer_id, is_demo_organizer(s.organizer_id)
    return DEMO_ORGANIZER_ID, True
