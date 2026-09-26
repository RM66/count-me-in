"""Domain error classes for the data layer.

One module so httpx_/errors.py can map every failure mode without
importing the whole data layer (and so the data modules can raise
without import cycles).
"""

from __future__ import annotations


class DemoReadOnlyError(Exception):
    """A write was attempted against the read-only demo account (ADR-010)."""


class SlotSoldOutError(Exception):
    def __init__(self, seats_left: int) -> None:
        # seats_left travels with it so the dialog can say how many are
        # actually left rather than only that the attempt failed.
        self.seats_left = seats_left
        super().__init__(f"slot sold out, {seats_left} seats left")


class SlotNotBookableError(Exception):
    def __init__(self) -> None:
        super().__init__("slot is not bookable")


class InvalidOptionSelectionError(Exception):
    def __init__(self, detail: str) -> None:
        # The class message carries the English validation detail for
        # logs; the body gets the machine-readable code plus localized
        # copy, and the booking dialog re-renders it from the code.
        super().__init__(detail)


class PartyTooLargeError(Exception):
    def __init__(self, max_seats: int) -> None:
        self.max_seats = max_seats
        super().__init__(f"party size over per-booking cap of {max_seats}")


class BookingAlreadyCancelledError(Exception):
    def __init__(self) -> None:
        super().__init__("booking already cancelled")


class DuplicateBookingError(Exception):
    def __init__(self) -> None:
        super().__init__("duplicate booking")


class ManageTokenExpiredError(Exception):
    def __init__(self) -> None:
        super().__init__("manage token expired")


class NoOrganizerUpdatesError(Exception):
    def __init__(self) -> None:
        super().__init__("no organizer updates")


class OrganizerNotFoundError(Exception):
    def __init__(self) -> None:
        super().__init__("organizer not found")


class NoServiceUpdatesError(Exception):
    def __init__(self) -> None:
        super().__init__("no service updates")


class ServiceHasBookingsError(Exception):
    def __init__(self) -> None:
        super().__init__("service has bookings")


class NoSlotUpdatesError(Exception):
    def __init__(self) -> None:
        super().__init__("no slot updates")


class SlotCapacityBelowBookedError(Exception):
    def __init__(self, booked_count: int) -> None:
        self.booked_count = booked_count
        super().__init__(f"capacity below booked count {booked_count}")


class SlotHasActiveBookingsError(Exception):
    def __init__(self) -> None:
        super().__init__("slot has active bookings")
