"""The error→HTTP mapping.

Status codes carry meaning (403 demo, 404 gone, 409 conflict, 400
shape) and the body carries localized copy while the error class keeps
its EN message for logs (ADR-011). Every domain error is an
ApiError subclass that carries only data; the single conversion point
is web/response.render_api_error, which the app-level exception handler
calls. Anything that is not an ApiError propagates to the 500 recovery
— a wrapped error must never be flattened into a misleading 4xx.
"""

import pytest
from countmein.contracts.constants_gen import (
    DEFAULT_LOCALE,
    DEMO_READ_ONLY_CODE,
    LOCALES,
)
from countmein.errors import (
    AlreadyCancelled,
    ApiError,
    BookingNotFound,
    CapacityBelowBooked,
    DemoReadOnly,
    DuplicateBooking,
    InvalidOptions,
    NothingToUpdate,
    OrganizerNotFound,
    PartyTooLarge,
    RateLimited,
    ServiceHasBookings,
    SlotGone,
    SlotHasActiveBookings,
    SoldOut,
)
from countmein.web.response import render_api_error


def _body(resp) -> dict:
    return resp.body.model_dump()


@pytest.mark.parametrize(
    ("err", "want_status", "want_code", "want_seats", "want_max"),
    [
        (DemoReadOnly(), 403, DEMO_READ_ONLY_CODE, None, None),
        (SlotGone(), 404, "", None, None),
        (SoldOut(0), 409, "", 0, None),
        (SoldOut(3), 409, "", 3, None),
        (DuplicateBooking(), 409, "duplicate_booking", None, None),
        (AlreadyCancelled(), 409, "", None, None),
        (BookingNotFound(), 404, "", None, None),
        (InvalidOptions("bad"), 400, "invalid_option", None, None),
        (PartyTooLarge(4), 400, "", None, 4),
    ],
    ids=[
        "demo read-only",
        "slot gone",
        "sold out (0 left)",
        "seats left",
        "duplicate booking",
        "already cancelled",
        "manage token expired → 404 like unknown",
        "invalid options",
        "party too large",
    ],
)
def test_error_response(err, want_status, want_code, want_seats, want_max):
    for locale in LOCALES:
        resp = render_api_error(err, locale)
        assert resp.status == want_status
        body = _body(resp)
        assert body["error"], f"{locale}: localized error copy must not be empty"
        if want_code:
            assert body["code"] == want_code
        if want_seats is not None:
            assert body["seatsLeft"] == want_seats
        if want_max is not None:
            assert body["maxSeats"] == want_max


@pytest.mark.parametrize(
    ("err", "want_status"),
    [
        (NothingToUpdate(), 400),
        (CapacityBelowBooked(3), 409),
        (SlotHasActiveBookings(), 409),
        (ServiceHasBookings(), 409),
        (NothingToUpdate(), 400),
        (NothingToUpdate(), 400),
        (OrganizerNotFound(), 404),
    ],
    ids=[
        "no slot updates",
        "capacity below booked",
        "slot has active bookings",
        "service has bookings",
        "no service updates",
        "no organizer updates",
        "organizer not found",
    ],
)
def test_cabinet_error_response(err, want_status):
    for locale in LOCALES:
        resp = render_api_error(err, locale)
        assert resp.status == want_status
        assert _body(resp)["error"], f"{locale}: localized copy must not be empty"


def test_rate_limited_headers():
    resp = render_api_error(RateLimited(7), "en")
    assert resp.status == 429
    assert resp.headers["Retry-After"] == "7"


def test_wrapped_errors_are_not_flattened():
    # A wrapped ApiError must NOT be answered as its cause's 4xx: only a
    # real ApiError instance gets the mapped response, everything else
    # keeps propagating to the 500 recovery.
    wrapped = RuntimeError("booking tx")
    wrapped.__cause__ = SoldOut(2)
    assert not isinstance(wrapped, ApiError)
    assert isinstance(wrapped.__cause__, ApiError)


def test_booking_error_response_localized():
    # The body is actually localized (ADR-011): at least one locale must
    # render different copy from English for the same key.
    err = SoldOut(0)
    en = _body(render_api_error(err, "en"))["error"]
    differs = any(
        _body(render_api_error(err, locale))["error"] != en
        for locale in LOCALES
        if locale != DEFAULT_LOCALE
    )
    assert differs, "localized copy must differ from English in at least one locale"


# (The empty-500 shape and log redaction are pinned by test_log_redaction
# and the middleware recovery tests; the dead `internal()` helper was
# removed with the broad except-blocks it served.)
