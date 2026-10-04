"""The API exception hierarchy.

One base class carries everything a handler needs to answer an error:
status, i18n key, machine code, optional ICU params, optional ErrorBody
extra fields, optional headers. Subclasses are the domain failure
modes — raised where they happen, rendered by the app-level `ApiError`
handler, so route handlers never pattern-match exception chains or
flatten an unexpected error into a misleading 4xx: anything that is
not an ApiError propagates to the 500 recovery.

This module holds only data: the error→Response conversion lives in
web/response.render_api_error, wired once in app.py — the lower layer
never depends on the transport.
"""

from __future__ import annotations

from typing import Any


class ApiError(Exception):
    """Base: an error the API answers with a specific status + copy.

    `code` defaults to `key` — subclasses set it when the wire pins a
    different stable token (slot_sold_out, duplicate_booking, …).
    `params` feeds the ICU message, `extra` additional ErrorBody fields
    (seatsLeft/maxSeats), `headers` extra response headers."""

    status = 500
    key = "internal"
    code: str | None = None
    params: dict[str, object] | None = None
    extra: dict[str, Any] | None = None
    headers: dict[str, str] | None = None


class ValidationFailed(Exception):
    """A request body failed schema validation (400).

    Deliberately NOT an ApiError: the body is the shared invalid_body
    envelope ({error, details}), rendered by the app-level handler so
    routes never catch ValidationFailed locally."""

    def __init__(self, errors: object) -> None:
        self.errors = errors
        super().__init__("request body failed validation")


class DemoReadOnly(ApiError):
    """A write was attempted against the read-only demo account (403)."""

    status = 403
    key = "demoReadOnly"

    def __init__(self) -> None:
        from .contracts.constants_gen import DEMO_READ_ONLY_CODE

        self.code = DEMO_READ_ONLY_CODE
        super().__init__("demo organizer is read-only")


class RateLimited(ApiError):
    """The per-request rate bucket is exhausted (429)."""

    status = 429
    key = "tooManyRequests"

    def __init__(self, retry_after: int) -> None:
        self.retry_after = retry_after
        self.headers = {"Retry-After": str(retry_after)}
        super().__init__(f"rate limited, retry after {retry_after}s")


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
    (401) — answered identically, so the endpoint cannot probe whether
    a ticket exists."""

    status = 401
    key = "ticketExpired"


class UnauthorizedInternal(ApiError):
    """An internal service request lacked a valid internal secret (401)."""

    status = 401
    key = "unauthorizedInternal"


class TelegramNotConfiguredError(ApiError):
    """TELEGRAM_BOT_TOKEN is absent — the widget payload cannot be
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
    # Pinned by the client: the booking dialog reacts to this token.
    code = "slot_sold_out"

    def __init__(self, seats_left: int) -> None:
        self.seats_left = seats_left
        # The copy differs by whether anything is left at all.
        self.key = "soldOut" if seats_left == 0 else "seatsLeftOnSession"
        self.params = None if seats_left == 0 else {"count": seats_left}
        self.extra = {"seatsLeft": seats_left}
        super().__init__(f"slot sold out, {seats_left} seats left")


class DuplicateBooking(ApiError):
    """The same guest already holds a confirmed booking on the slot (409)."""

    status = 409
    key = "duplicateBooking"
    code = "duplicate_booking"


class AlreadyCancelled(ApiError):
    """The booking is already cancelled (409)."""

    status = 409
    key = "alreadyCancelled"


class BookingNotFound(ApiError):
    """Unknown or expired manage token (404) — expiry answers like
    unknown, so the endpoint cannot probe token existence."""

    status = 404
    key = "bookingNotFound"


class InvalidOptions(ApiError):
    """The selected options violate the service's option rules (400).
    The class message carries the English detail for logs; the body
    gets the code plus localized copy."""

    status = 400
    key = "invalidOptions"
    code = "invalid_option"


class PartyTooLarge(ApiError):
    """The requested seats exceed the service's per-booking cap (400)."""

    status = 400
    key = "partyTooLarge"

    def __init__(self, max_seats: int) -> None:
        self.max_seats = max_seats
        self.params = {"maxSeats": max_seats}
        self.extra = {"maxSeats": max_seats}
        super().__init__(f"party size over per-booking cap of {max_seats}")


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
        self.params = {"count": booked_count}
        super().__init__(f"capacity below booked count {booked_count}")


class SlotHasActiveBookings(ApiError):
    """The slot is referenced by booking rows (confirmed or cancelled)
    — a booked slot cannot be deleted (409)."""

    status = 409
    key = "slotHasActiveBookings"


class ServiceHasBookings(ApiError):
    """A booking row references one of the service's slots — deleting
    would lose guest records (409)."""

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
    """Structurally unreachable empty INSERT … RETURNING (500) — a
    defensive backstop: a silent empty result must never 201."""

    status = 500
    key = "cannotCreateService"
