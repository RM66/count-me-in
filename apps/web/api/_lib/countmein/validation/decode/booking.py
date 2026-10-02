"""Booking input decoders — named shims over the rules-driven generic
decode (ADR-024 C1/C2)."""

from __future__ import annotations

from ...contracts import models_gen as gen
from .core import decode_input


def decode_create_booking_input(body: bytes) -> gen.CreateBookingInput:
    return decode_input(gen.CreateBookingInput, "CreateBookingInput", body)


def decode_cancel_booking_by_token_input(body: bytes) -> gen.CancelBookingByTokenInput:
    return decode_input(gen.CancelBookingByTokenInput, "CancelBookingByTokenInput", body)


def decode_lookup_booking_by_token_input(body: bytes) -> gen.LookupBookingByTokenInput:
    return decode_input(gen.LookupBookingByTokenInput, "LookupBookingByTokenInput", body)


def decode_lookup_bookings_input(body: bytes) -> gen.LookupBookingsInput:
    return decode_input(gen.LookupBookingsInput, "LookupBookingsInput", body)


def decode_cancel_booking_by_organizer_input(
    body: bytes,
) -> gen.CancelBookingByOrganizerInput:
    return decode_input(gen.CancelBookingByOrganizerInput, "CancelBookingByOrganizerInput", body)
