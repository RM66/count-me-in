"""Demo-account guard (ADR-010): the seeded demo organizer is read-only.

Every write path must reject it, including guest booking + cancel, and
notifications must never be sent for it.
"""

from ..contracts.constants_gen import DEMO_ORGANIZER_ID, DEMO_ORGANIZER_SLUG
from .errors import DemoReadOnlyError


def is_demo_organizer(organizer_id: str) -> bool:
    # str() normalizes a UUID object that slipped past the row mappers —
    # a raw UUID == str comparison is always False and would silently
    # disable the read-only guard (ADR-010).
    return str(organizer_id) == DEMO_ORGANIZER_ID


def is_demo_slug(slug: str) -> bool:
    return slug == DEMO_ORGANIZER_SLUG


def is_read_only(organizer_id: str) -> bool:
    """True for anonymous ("") and for the demo account itself. Call on
    every write path, including guest-facing ones."""
    return organizer_id == "" or is_demo_organizer(organizer_id)


def refuse_demo_write(organizer_id: str) -> None:
    """Raise DemoReadOnlyError when the id is the demo account's or
    absent (anonymous — i.e. a demo cabinet visitor)."""
    if is_read_only(organizer_id):
        raise DemoReadOnlyError()
