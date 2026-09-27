"""Time-slot input decoders, including the merged-state
decoder the PUT handler runs over current+patch (ADR-016)."""

from __future__ import annotations

from ...contracts import models_gen as gen
from ...errors import ValidationFailed
from ..errors import Errors
from ..refine import refine_slot_merged_state, refine_slot_start
from .core import _finish, _raw, _validate_model


def decode_create_time_slot_input(body: bytes) -> gen.CreateTimeSlotInput:
    m = _raw(body)
    from ..errors import trim_key

    trim_key(m, "price")
    out, errs = _validate_model(gen.CreateTimeSlotInput, m, "CreateTimeSlotInput")
    if errs is not None:
        raise ValidationFailed(errs)
    if out is None:
        raise RuntimeError("out is None after its error guard")
    e = Errors()
    refine_slot_start(e, out.startsAt)
    return _finish(out, e)


def decode_update_time_slot_input(body: bytes) -> gen.UpdateTimeSlotInput:
    m = _raw(body)
    from ..errors import trim_key

    trim_key(m, "price")
    out, errs = _validate_model(gen.UpdateTimeSlotInput, m, "UpdateTimeSlotInput")
    if errs is not None:
        raise ValidationFailed(errs)
    if out is None:
        raise RuntimeError("out is None after its error guard")
    e = Errors()
    if out.startsAt is not None:
        refine_slot_start(e, out.startsAt)
    return _finish(out, e)


def decode_merged_slot_input(merged: bytes, starts_at_touched: bool) -> gen.UpdateTimeSlotInput:
    """Validate a merged slot state; startsAt is only checked against
    the past when the patch touched it (the merged state always carries
    the current value, which may legitimately be past)."""
    m = _raw(merged)
    from ..errors import trim_key

    trim_key(m, "price")
    out, errs = _validate_model(gen.UpdateTimeSlotInput, m, "UpdateTimeSlotInput")
    if errs is not None:
        raise ValidationFailed(errs)
    if out is None:
        raise RuntimeError("out is None after its error guard")
    e = Errors()
    refine_slot_merged_state(e, out, starts_at_touched)
    return _finish(out, e)
