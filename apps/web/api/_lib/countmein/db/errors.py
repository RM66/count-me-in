"""Domain error classes for the data layer.

Every domain error is an ApiError subclass (countmein/errors.py):
raised where it happens, rendered by the app-level exception handler.
This module re-exports the canonical names so the data modules and
tests import one place; the two data-layer-specific mappings the
generic hierarchy does not own (unique-violation → SlugTaken /
AccountExists) are decided by constraint name in the route, not here.
"""

from __future__ import annotations

from ..errors import (
    AccountExists,
    AlreadyCancelled,
    BookingNotFound,
    CapacityBelowBooked,
    DuplicateBooking,
    InvalidOptions,
    NothingToUpdate,
    OrganizerNotFound,
    PartyTooLarge,
    ServiceHasBookings,
    SlotGone,
    SlotHasActiveBookings,
    SoldOut,
)

__all__ = [
    "AccountExists",
    "AlreadyCancelled",
    "BookingNotFound",
    "CapacityBelowBooked",
    "DuplicateBooking",
    "InvalidOptions",
    "NothingToUpdate",
    "OrganizerNotFound",
    "PartyTooLarge",
    "ServiceHasBookings",
    "SlotGone",
    "SlotHasActiveBookings",
    "SoldOut",
]
