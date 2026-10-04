"""Time-slot input decoders — including the merged-state decoder the
PATCH handler runs over current+patch (ADR-016)."""

from __future__ import annotations

from ...contracts import models_gen as gen
from .core import decode_input, decode_merged


def decode_create_time_slot_input(body: bytes) -> gen.CreateTimeSlotInput:
    return decode_input(gen.CreateTimeSlotInput, body)


def decode_update_time_slot_input(body: bytes) -> gen.UpdateTimeSlotInput:
    return decode_input(gen.UpdateTimeSlotInput, body)


def decode_merged_slot_input(merged: bytes, touched: frozenset[str]) -> gen.UpdateTimeSlotInput:
    """Validate a merged slot state; startsAt is checked against the past
    only when the patch actually touched it (the merged state always
    carries the current value, which may legitimately be past)."""
    return decode_merged(
        gen.UpdateTimeSlotInput,
        merged,
        touched={"startsAt"} & touched,
    )
