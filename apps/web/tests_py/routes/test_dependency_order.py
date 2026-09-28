"""The dependency-order meta-test.

FastAPI resolves a handler's Depends parameters in declaration order,
which pins the order of side effects — but that order was only pinned
indirectly (by the behavior tests). This test inspects every write
handler's signature directly and asserts the load-bearing sequence:

1. rate limit (before any body is read — a limited caller must not
   burn the body budget),
2. body read (bounded, 413),
3. decode (a validation failure must NOT consume the guest ticket),
4. the ticket dependency (single-use identity).

The dependencies are tagged with their pipeline stage at creation
(web/deps.py, `__countmein_stage__`), so the test reads the tags
instead of guessing from names. Session guards (require_writable_
organizer) are deliberately untagged: their position is not pinned —
they consume nothing single-use and may legitimately run first.
"""

from __future__ import annotations

import inspect

import pytest
from countmein.routes.auth import telegram_guest, telegram_signup
from countmein.routes.bookings import (
    booking_cancel,
    booking_cancel_by_organizer,
    booking_create,
    booking_lookup,
)
from countmein.routes.organizers import (
    organizer_avatar,
    organizer_me_language,
    organizer_me_put,
    organizer_register,
    organizer_service_photo,
)
from countmein.routes.services import (
    service_delete,
    service_put,
    services_create,
)
from countmein.routes.slots import (
    slot_delete,
    slot_put,
    slots_create,
)

ALL_WRITE_HANDLERS = [
    telegram_guest,
    telegram_signup,
    booking_create,
    booking_lookup,
    booking_cancel,
    booking_cancel_by_organizer,
    organizer_register,
    organizer_me_put,
    organizer_me_language,
    organizer_avatar,
    organizer_service_photo,
    services_create,
    service_put,
    slots_create,
    slot_put,
]

# The load-bearing pipeline order (see web/deps.py's module docstring).
STAGE_ORDER = {"ratelimit": 0, "body": 1, "decode": 2, "ticket": 3}


def _stages(handler) -> list[str]:
    """The pipeline stages of a handler's direct Depends parameters, in
    declaration order (untagged dependencies — session guards, content
    type, engine — are skipped: their position is not pinned)."""
    out: list[str] = []
    for param in inspect.signature(handler).parameters.values():
        # fastapi.Depends is a factory function; the parameter default is
        # the marker it returns, recognized by its .dependency attribute.
        marker = getattr(param.default, "dependency", None)
        if marker is None:
            continue
        stage = getattr(marker, "__countmein_stage__", None)
        if stage is not None:
            out.append(str(stage))
    return out


@pytest.mark.parametrize("handler", ALL_WRITE_HANDLERS, ids=lambda h: h.__name__)
def test_route_dependencies_order(handler):
    stages = _stages(handler)
    assert stages, f"{handler.__name__}: no tagged dependencies found"
    indices = [STAGE_ORDER[s] for s in stages]
    assert indices == sorted(indices), (
        f"{handler.__name__}: dependencies out of order: {stages} "
        "(must be ratelimit → body → decode → ticket)"
    )


def test_delete_handlers_have_no_pipeline_stages():
    """The delete routes take no body and no ticket — only the session
    guard and the uuid path param — so they must carry no pipeline
    stages at all (a stage appearing there would mean a stray
    dependency crept in)."""

    assert _stages(service_delete) == []
    assert _stages(slot_delete) == []


def test_guest_ticket_sits_after_decode():
    """The single most load-bearing order: a validation failure must not
    consume the guest ticket. Every handler that declares the ticket
    dependency must also declare the decode dependency before it."""
    for handler in (booking_create, booking_lookup):
        stages = _stages(handler)
        assert "decode" in stages and "ticket" in stages, (
            f"{handler.__name__}: expected both decode and ticket stages"
        )
        assert stages.index("decode") < stages.index("ticket")
