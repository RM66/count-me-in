"""Booking input decoders."""

from __future__ import annotations

from ...contracts import models_gen as gen
from ...errors import ValidationFailed
from .core import _raw, _validate_model


def decode_create_booking_input(body: bytes) -> gen.CreateBookingInput:
    m = _raw(body)
    from ..errors import trim_key

    trim_key(m, "guestName")
    trim_key(m, "selectedOptions")
    out, errs = _validate_model(gen.CreateBookingInput, m, "CreateBookingInput")
    if errs is not None:
        raise ValidationFailed(errs)
    if out is None:
        # Unreachable by the decode/guard contract; a real None
        # here is a bug, and python -O must not strip the check.
        raise RuntimeError("out is None after its error guard")
    return out


def decode_cancel_booking_by_token_input(body: bytes) -> gen.CancelBookingByTokenInput:
    m = _raw(body)
    out, errs = _validate_model(gen.CancelBookingByTokenInput, m, "CancelBookingByTokenInput")
    if errs is not None:
        raise ValidationFailed(errs)
    if out is None:
        raise RuntimeError("out is None after its error guard")
    return out


def decode_lookup_bookings_input(body: bytes) -> gen.LookupBookingsInput:
    m = _raw(body)
    out, errs = _validate_model(gen.LookupBookingsInput, m, "LookupBookingsInput")
    if errs is not None:
        raise ValidationFailed(errs)
    if out is None:
        raise RuntimeError("out is None after its error guard")
    return out


def decode_cancel_booking_by_organizer_input(
    body: bytes,
) -> gen.CancelBookingByOrganizerInput:
    m = _raw(body)
    out, errs = _validate_model(
        gen.CancelBookingByOrganizerInput, m, "CancelBookingByOrganizerInput"
    )
    if errs is not None:
        raise ValidationFailed(errs)
    if out is None:
        raise RuntimeError("out is None after its error guard")
    return out
