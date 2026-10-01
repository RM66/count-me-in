"""Booking input decoders."""

from __future__ import annotations

from ...contracts import models_gen as gen
from ..transforms import trim_key
from .core import _decode_model, _raw


def decode_create_booking_input(body: bytes) -> gen.CreateBookingInput:
    m = _raw(body)
    trim_key(m, "guestName")
    trim_key(m, "selectedOptions")
    return _decode_model(gen.CreateBookingInput, m, "CreateBookingInput")


def decode_cancel_booking_by_token_input(body: bytes) -> gen.CancelBookingByTokenInput:
    return _decode_model(gen.CancelBookingByTokenInput, _raw(body), "CancelBookingByTokenInput")


def decode_lookup_booking_by_token_input(body: bytes) -> gen.LookupBookingByTokenInput:
    return _decode_model(gen.LookupBookingByTokenInput, _raw(body), "LookupBookingByTokenInput")


def decode_lookup_bookings_input(body: bytes) -> gen.LookupBookingsInput:
    return _decode_model(gen.LookupBookingsInput, _raw(body), "LookupBookingsInput")


def decode_cancel_booking_by_organizer_input(
    body: bytes,
) -> gen.CancelBookingByOrganizerInput:
    return _decode_model(
        gen.CancelBookingByOrganizerInput, _raw(body), "CancelBookingByOrganizerInput"
    )
