"""Mapping entity failure modes onto HTTP responses.

Status codes carry meaning:
  - 403 demo account — correctly identified, action forbidden
  - 404 slot/service gone — nothing to book
  - 409 sold out / already cancelled / duplicate — well-formed request,
    conflicting state
  - 400 invalid option selection / party over the per-booking cap

Each mapper returns None for anything else, so an unexpected error keeps
propagating as a 500 instead of being flattened into a misleading 4xx.
"""

from __future__ import annotations

from ..contracts.models_gen import ErrorBody
from ..db.errors import (
    BookingAlreadyCancelledError,
    DuplicateBookingError,
    InvalidOptionSelectionError,
    ManageTokenExpiredError,
    NoOrganizerUpdatesError,
    NoServiceUpdatesError,
    NoSlotUpdatesError,
    OrganizerNotFoundError,
    PartyTooLargeError,
    ServiceHasBookingsError,
    SlotCapacityBelowBookedError,
    SlotHasActiveBookingsError,
    SlotNotBookableError,
    SlotSoldOutError,
)
from ..demo.errors import DemoReadOnlyError
from .response import Response, demo_read_only, error, error_extras, error_params


def _errors_as[E: BaseException](err: BaseException, cls: type[E]) -> E | None:
    """The Go errors.As analogue: walk the exception chain (cause/context),
    not just the outermost type — a wrapped error must not slip past the
    mapping into a bare 500 (applied to every mapper in this file)."""
    seen: set[int] = set()
    current: BaseException | None = err
    while current is not None and id(current) not in seen:
        if isinstance(current, cls):
            return current
        seen.add(id(current))
        current = current.__cause__ or current.__context__
    return None


def booking_error_response(err: BaseException, locale: str) -> Response | None:
    found = _errors_as(err, DemoReadOnlyError)
    if found is not None:
        return demo_read_only(locale)
    if _errors_as(err, SlotNotBookableError) is not None:
        return error(404, locale, "slotGone")
    sold_out = _errors_as(err, SlotSoldOutError)
    if sold_out is not None:
        # seats_left travels with it so the dialog can say how many are
        # actually left rather than only that the attempt failed.
        if sold_out.seats_left == 0:
            return error_extras(409, locale, "soldOut", None, ErrorBody(error="", seatsLeft=0))
        return error_extras(
            409,
            locale,
            "seatsLeftOnSession",
            {"count": sold_out.seats_left},
            ErrorBody(error="", seatsLeft=sold_out.seats_left),
        )
    if _errors_as(err, DuplicateBookingError) is not None:
        return error_extras(
            409, locale, "duplicateBooking", None, ErrorBody(error="", code="duplicate_booking")
        )
    if _errors_as(err, BookingAlreadyCancelledError) is not None:
        return error(409, locale, "alreadyCancelled")
    if _errors_as(err, ManageTokenExpiredError) is not None:
        # Answered like an unknown token (404) so the endpoint cannot be
        # used to test whether a token exists.
        return error(404, locale, "bookingNotFound")
    if _errors_as(err, InvalidOptionSelectionError) is not None:
        # The class message carries the English validation detail for
        # logs; the body gets the machine-readable code plus localized
        # copy, and the booking dialog re-renders it from the code.
        return error_extras(
            400, locale, "invalidOptions", None, ErrorBody(error="", code="invalid_option")
        )
    too_large = _errors_as(err, PartyTooLargeError)
    if too_large is not None:
        return error_extras(
            400,
            locale,
            "partyTooLarge",
            {"maxSeats": too_large.max_seats},
            ErrorBody(error="", maxSeats=too_large.max_seats),
        )
    return None


def slot_error_response(err: BaseException, locale: str) -> Response | None:
    if _errors_as(err, NoSlotUpdatesError) is not None:
        return error(400, locale, "nothingToUpdate")
    found = _errors_as(err, SlotCapacityBelowBookedError)
    if found is not None:
        # The payload is well-formed, it conflicts with current state.
        return error_params(409, locale, "capacityBelowBooked", {"count": found.booked_count})
    if _errors_as(err, SlotHasActiveBookingsError) is not None:
        # The slot is referenced by booking rows (confirmed or cancelled)
        # — a booked slot cannot be deleted (no path removes the rows;
        # cancelled bookings are kept as guest history).
        return error(409, locale, "slotHasActiveBookings")
    return None


def service_error_response(err: BaseException, locale: str) -> Response | None:
    if _errors_as(err, NoServiceUpdatesError) is not None:
        return error(400, locale, "nothingToUpdate")
    if _errors_as(err, ServiceHasBookingsError) is not None:
        # A booking row (confirmed or cancelled) references one of the
        # service's slots — deleting would lose guest records.
        return error(409, locale, "serviceHasBookings")
    return None


def organizer_error_response(err: BaseException, locale: str) -> Response | None:
    if _errors_as(err, NoOrganizerUpdatesError) is not None:
        return error(400, locale, "nothingToUpdate")
    if _errors_as(err, OrganizerNotFoundError) is not None:
        return error(404, locale, "organizerNotFound")
    return None
