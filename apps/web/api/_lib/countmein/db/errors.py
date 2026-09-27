"""Domain error classes for the data layer.

Every domain error is an ApiError subclass (countmein/errors.py):
raised where it happens, rendered by the app-level exception handler.
This module keeps the historical names so the data modules and tests
import one place, and adds the two data-layer-specific mappings that
the generic hierarchy does not own (unique-violation → SlugTaken /
AccountExists is decided by constraint name in the route, not here).
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

# Historical names, unchanged call sites.
SlotSoldOutError = SoldOut
SlotNotBookableError = SlotGone
InvalidOptionSelectionError = InvalidOptions
PartyTooLargeError = PartyTooLarge
BookingAlreadyCancelledError = AlreadyCancelled
DuplicateBookingError = DuplicateBooking
ManageTokenExpiredError = BookingNotFound
NoOrganizerUpdatesError = NothingToUpdate
OrganizerNotFoundError = OrganizerNotFound
NoServiceUpdatesError = NothingToUpdate
ServiceHasBookingsError = ServiceHasBookings
NoSlotUpdatesError = NothingToUpdate
SlotCapacityBelowBookedError = CapacityBelowBooked
SlotHasActiveBookingsError = SlotHasActiveBookings
AccountExistsError = AccountExists
