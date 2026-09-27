"""The error→HTTP mapping.

Status codes carry meaning (403 demo, 404 gone, 409 conflict, 400
shape) and the body carries localized copy while the error class keeps
its EN message for logs (ADR-011). An unmapped error must return None
so the caller answers a bare 500 instead of being flattened into a
misleading 4xx.
"""

import pytest
from _lib.countmein.contracts.constants_gen import (
    DEFAULT_LOCALE,
    DEMO_READ_ONLY_CODE,
    LOCALES,
)
from _lib.countmein.db.errors import (
    BookingAlreadyCancelledError,
    DuplicateBookingError,
    InvalidOptionSelectionError,
    ManageTokenExpiredError,
    NoOrganizerUpdatesError,
    NoServiceUpdatesError,
    NoSlotUpdatesError,
    OrganizerNotFoundError,
    PartyTooLargeError,
    SlotCapacityBelowBookedError,
    SlotHasActiveBookingsError,
    SlotNotBookableError,
    SlotSoldOutError,
)
from _lib.countmein.demo import DemoReadOnlyError
from _lib.countmein.httpx_.errors import (
    booking_error_response,
    organizer_error_response,
    service_error_response,
    slot_error_response,
)
from _lib.countmein.httpx_.response import internal


def _body(resp) -> dict:
    return resp.body.model_dump()


@pytest.mark.parametrize(
    ("err", "want_status", "want_code", "want_seats", "want_max"),
    [
        (DemoReadOnlyError(), 403, DEMO_READ_ONLY_CODE, None, None),
        (SlotNotBookableError(), 404, "", None, None),
        (SlotSoldOutError(0), 409, "", 0, None),
        (SlotSoldOutError(3), 409, "", 3, None),
        (DuplicateBookingError(), 409, "duplicate_booking", None, None),
        (BookingAlreadyCancelledError(), 409, "", None, None),
        (ManageTokenExpiredError(), 404, "", None, None),
        (InvalidOptionSelectionError("bad"), 400, "invalid_option", None, None),
        (PartyTooLargeError(4), 400, "", None, 4),
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
def test_booking_error_response(err, want_status, want_code, want_seats, want_max):
    for locale in LOCALES:
        resp = booking_error_response(err, locale)
        assert resp is not None, f"expected a mapped response ({locale})"
        assert resp.status == want_status
        body = _body(resp)
        assert body["error"], f"{locale}: localized error copy must not be empty"
        if want_code:
            assert body["code"] == want_code
        if want_seats is not None:
            assert body["seatsLeft"] == want_seats
        if want_max is not None:
            assert body["maxSeats"] == want_max


def test_booking_error_response_wrapped():
    # Wrapped errors must not slip past the mapping into a bare 500.
    wrapped = RuntimeError("booking tx")
    wrapped.__cause__ = SlotSoldOutError(2)
    resp = booking_error_response(wrapped, "en")
    assert resp is not None and resp.status == 409
    wrapped_demo = RuntimeError("outer")
    wrapped_demo.__cause__ = DemoReadOnlyError()
    resp = booking_error_response(wrapped_demo, "en")
    assert resp is not None and resp.status == 403


def test_slot_service_organizer_error_response_wrapped():
    for make, want in (
        (lambda: SlotCapacityBelowBookedError(3), 409),
        (lambda: NoServiceUpdatesError(), 400),
        (lambda: NoOrganizerUpdatesError(), 400),
    ):
        wrapped = RuntimeError("tx")
        wrapped.__cause__ = make()
        mapper = (
            slot_error_response
            if isinstance(wrapped.__cause__, SlotCapacityBelowBookedError)
            else (
                service_error_response
                if isinstance(wrapped.__cause__, NoServiceUpdatesError)
                else organizer_error_response
            )
        )
        resp = mapper(wrapped, "en")
        assert resp is not None and resp.status == want


def test_booking_error_response_unknown():
    assert booking_error_response(RuntimeError("something new"), "en") is None


def test_booking_error_response_localized():
    # The body is actually localized (ADR-011): at least one locale must
    # render different copy from English for the same key.
    err = SlotSoldOutError(0)
    en = _body(booking_error_response(err, "en"))["error"]
    differs = any(
        _body(booking_error_response(err, locale))["error"] != en
        for locale in LOCALES
        if locale != DEFAULT_LOCALE
    )
    assert differs, "localized copy must differ from English in at least one locale"


@pytest.mark.parametrize(
    ("err", "want_status"),
    [
        (NoSlotUpdatesError(), 400),
        (SlotCapacityBelowBookedError(3), 409),
        (SlotHasActiveBookingsError(), 409),
    ],
    ids=["no updates", "capacity below booked", "slot has active bookings"],
)
def test_slot_error_response(err, want_status):
    for locale in LOCALES:
        resp = slot_error_response(err, locale)
        assert resp is not None and resp.status == want_status
        assert _body(resp)["error"], f"{locale}: localized copy must not be empty"
    assert slot_error_response(RuntimeError("other"), "en") is None


def test_service_error_response():
    for locale in LOCALES:
        resp = service_error_response(NoServiceUpdatesError(), locale)
        assert resp is not None and resp.status == 400
    assert service_error_response(RuntimeError("other"), "en") is None


def test_organizer_error_response():
    for locale in LOCALES:
        resp = organizer_error_response(NoOrganizerUpdatesError(), locale)
        assert resp is not None and resp.status == 400
    resp = organizer_error_response(OrganizerNotFoundError(), "en")
    assert resp is not None and resp.status == 404
    assert organizer_error_response(RuntimeError("other"), "en") is None


def test_internal_leaks_nothing():
    # Internal must not leak error details into the body — the class stays
    # in the log, the response is an empty 500.
    resp = internal(RuntimeError("secret db password: hunter2"))
    assert resp.status == 500
    assert resp.body is None
