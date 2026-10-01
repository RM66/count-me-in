"""The API exception hierarchy.

One base class carries everything a handler needs to answer an error:
status, i18n key, optional ICU params, and optional ErrorBody extras.
Subclasses are the domain failure modes — raised where they happen,
rendered by the app-level `ApiError` exception handler, so route
handlers stop pattern-matching exception chains (`_errors_as` is gone)
and never flatten an unexpected error into a misleading 4xx: anything
that is not an ApiError keeps propagating to the 500 recovery.

This module deliberately holds only data: the error→Response conversion
lives in the transport (web/response.render_api_error) and is wired in
exactly one place — the exception handler registered in app.py — so the
lower layer never depends on the transport.

Byte-identical bodies: render_api_error reuses the existing renderer
(web/response.py), which the parity goldens pin.
"""

from __future__ import annotations

from collections.abc import Iterator

from .contracts.models_gen import ErrorBody


def walk_exception_chain(err: BaseException) -> Iterator[BaseException]:
    """Yield err and everything it wraps via __cause__/__context__, each
    exception once. A wrapped driver error must not slip past a mapping
    into a bare 500 — the three former word-for-word copies of this walk
    (SQLSTATE classification, unique-constraint naming, job error
    mapping) all build on it."""
    seen: set[int] = set()
    current: BaseException | None = err
    while current is not None and id(current) not in seen:
        yield current
        seen.add(id(current))
        current = current.__cause__ or current.__context__


class ApiError(Exception):
    """Base: an error the API answers with a specific status + copy."""

    status = 500
    key = "internal"

    def params(self) -> dict[str, object] | None:
        """ICU params for the localized message, if any."""
        return None

    def headers(self) -> dict[str, str] | None:
        """Extra response headers (e.g. Retry-After), if any."""
        return None

    def extras(self) -> ErrorBody | None:
        """Additional ErrorBody fields (code/seatsLeft/maxSeats), if any."""
        return None

    def response_key(self) -> str:
        """The i18n key the response renders — a hook for the errors
        whose copy depends on the instance (SoldOut)."""
        return self.key


class ValidationFailed(Exception):
    """A request body failed schema validation (400).

    Deliberately NOT an ApiError: the body shape is the shared
    invalid_body envelope ({error, details}), rendered by the app-level
    handler so route handlers never catch ValidationFailed locally."""

    def __init__(self, errors: object) -> None:
        self.errors = errors
        super().__init__("request body failed validation")


class DemoReadOnly(ApiError):
    """A write was attempted against the read-only demo account (403)."""

    status = 403
    key = "demoReadOnly"

    def extras(self) -> ErrorBody:
        from .contracts.constants_gen import DEMO_READ_ONLY_CODE

        return ErrorBody(error="", code=DEMO_READ_ONLY_CODE)


class RateLimited(ApiError):
    """The per-request rate bucket is exhausted (429)."""

    status = 429
    key = "tooManyRequests"

    def __init__(self, retry_after: int) -> None:
        self.retry_after = retry_after
        super().__init__(f"rate limited, retry after {retry_after}s")

    def headers(self) -> dict[str, str]:
        return {"Retry-After": str(self.retry_after)}


class PayloadTooLarge(ApiError):
    """The request body exceeded the 1MB bound (413)."""

    status = 413
    key = "bodyTooLarge"


class UnsupportedMediaType(ApiError):
    """A merge-patch endpoint got a non-RFC 7386 media type (415)."""

    status = 415
    key = "unsupportedMediaType"


class TicketExpired(ApiError):
    """A guest/organizer ticket is unknown, expired, or wrong-purpose
    (401) — answered identically so the endpoint cannot be used to
    test whether a ticket exists."""

    status = 401
    key = "ticketExpired"


class UnauthorizedInternal(ApiError):
    """An internal service request lacked a valid internal secret (401)."""

    status = 401
    key = "unauthorizedInternal"


class TelegramNotConfiguredError(ApiError):
    """TELEGRAM_BOT_TOKEN is absent, so the widget payload cannot be
    validated (500 telegramNotConfigured)."""

    status = 500
    key = "telegramNotConfigured"


class TelegramInvalidError(ApiError):
    """The Telegram Login Widget payload is malformed (400
    telegramInvalid)."""

    status = 400
    key = "telegramInvalid"


class TelegramValidationFailedError(ApiError):
    """The Telegram Login Widget payload failed HMAC or freshness
    validation (400 telegramValidationFailed)."""

    status = 400
    key = "telegramValidationFailed"


class SlotGone(ApiError):
    """The slot a guest tried to book is gone (404)."""

    status = 404
    key = "slotGone"


class SoldOut(ApiError):
    """The slot has fewer seats than requested (409).

    seats_left travels with it so the dialog can say how many are
    actually left rather than only that the attempt failed."""

    status = 409

    def __init__(self, seats_left: int) -> None:
        self.seats_left = seats_left
        super().__init__(f"slot sold out, {seats_left} seats left")

    def response_key(self) -> str:
        # The copy differs by whether anything is left at all.
        return "soldOut" if self.seats_left == 0 else "seatsLeftOnSession"

    def params(self) -> dict[str, object] | None:
        return None if self.seats_left == 0 else {"count": self.seats_left}

    def extras(self) -> ErrorBody:
        return ErrorBody(error="", seatsLeft=self.seats_left)


class DuplicateBooking(ApiError):
    """The same guest already holds a confirmed booking on the slot (409)."""

    status = 409
    key = "duplicateBooking"

    def extras(self) -> ErrorBody:
        return ErrorBody(error="", code="duplicate_booking")


class AlreadyCancelled(ApiError):
    """The booking is already cancelled (409)."""

    status = 409
    key = "alreadyCancelled"


class BookingNotFound(ApiError):
    """Unknown or expired manage token (404) — the expiry case is
    answered like an unknown one so the endpoint cannot test whether
    a token exists."""

    status = 404
    key = "bookingNotFound"


class InvalidOptions(ApiError):
    """The selected options do not satisfy the service's option rules
    (400). The class message carries the English validation detail for
    logs; the body gets the machine-readable code plus localized copy."""

    status = 400
    key = "invalidOptions"

    def __init__(self, detail: str) -> None:
        super().__init__(detail)

    def extras(self) -> ErrorBody:
        return ErrorBody(error="", code="invalid_option")


class PartyTooLarge(ApiError):
    """The requested seats exceed the service's per-booking cap (400)."""

    status = 400
    key = "partyTooLarge"

    def __init__(self, max_seats: int) -> None:
        self.max_seats = max_seats
        super().__init__(f"party size over per-booking cap of {max_seats}")

    def params(self) -> dict[str, object]:
        return {"maxSeats": self.max_seats}

    def extras(self) -> ErrorBody:
        return ErrorBody(error="", maxSeats=self.max_seats)


class NothingToUpdate(ApiError):
    """A merge-patch document touched no known field (400)."""

    status = 400
    key = "nothingToUpdate"


class CapacityBelowBooked(ApiError):
    """The new capacity is below the already-booked count (409)."""

    status = 409
    key = "capacityBelowBooked"

    def __init__(self, booked_count: int) -> None:
        self.booked_count = booked_count
        super().__init__(f"capacity below booked count {booked_count}")

    def params(self) -> dict[str, object]:
        return {"count": self.booked_count}


class SlotHasActiveBookings(ApiError):
    """The slot is referenced by booking rows (confirmed or cancelled)
    — a booked slot cannot be deleted (no path removes the rows;
    cancelled bookings are kept as guest history). (409)"""

    status = 409
    key = "slotHasActiveBookings"


class ServiceHasBookings(ApiError):
    """A booking row (confirmed or cancelled) references one of the
    service's slots — deleting would lose guest records. (409)"""

    status = 409
    key = "serviceHasBookings"


class OrganizerNotFound(ApiError):
    """The organizer row is gone (404)."""

    status = 404
    key = "organizerNotFound"


class SlugTaken(ApiError):
    """The requested slug is already occupied (409)."""

    status = 409
    key = "slugTaken"


class AccountExists(ApiError):
    """The messenger identity already registered an organizer (409)."""

    status = 409
    key = "accountExists"


class DemoNotSeeded(ApiError):
    """The demo organizer row is missing — the seed has not run (404)."""

    status = 404
    key = "demoNotSeeded"


class SlotNotFound(ApiError):
    """The organizer asked for a slot they do not own / that is gone
    (404)."""

    status = 404
    key = "slotNotFound"


class ServiceNotFound(ApiError):
    """The organizer asked for a service they do not own / that is gone
    (404)."""

    status = 404
    key = "serviceNotFound"


class InvalidInput(ApiError):
    """A merged patch state failed re-validation (400)."""

    status = 400
    key = "invalidInput"


class PhotoPrefix(ApiError):
    """A submitted photoUrl is outside the organizer's media prefix
    (400) — the row must not point at an arbitrary host or another
    organizer's object."""

    status = 400
    key = "photoPrefix"


class CannotCreateService(ApiError):
    """Structurally unreachable empty INSERT … RETURNING (500) — kept
    as defensive parity with the TS check, where drizzle's .returning()
    could yield an empty array."""

    status = 500
    key = "cannotCreateService"
