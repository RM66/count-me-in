"""Service input decoders, including the merged-state
decoder the PUT handler runs over current+patch (ADR-016)."""

from __future__ import annotations

from ...contracts import models_gen as gen
from ...errors import ValidationFailed
from ..refine import refine_service_merged_state, refine_service_options
from ..rules import url_rule
from .core import _decode_collect, _finish, _raw


def _trim_service_keys(m: dict[str, object]) -> None:
    from ..transforms import trim_key

    for key in ("title", "description", "location", "contact", "defaultPrice", "options"):
        trim_key(m, key)


def decode_create_service_input(body: bytes) -> gen.CreateServiceInput:
    m = _raw(body)
    _trim_service_keys(m)
    out, e = _decode_collect(gen.CreateServiceInput, m, "CreateServiceInput")
    if out is not None and out.photoUrl is not None:
        msg = url_rule(str(out.photoUrl))
        if msg:
            e.add("photoUrl", msg)
    if out is not None:
        refine_service_options(e, out.options, out.optionsSelectMode)
    if out is None:
        raise ValidationFailed(e)
    return _finish(out, e)


def decode_update_service_input(body: bytes) -> gen.UpdateServiceInput:
    """Validate a merge-patch document against the update schema,
    including the options/mode pair check on the patch itself (parity
    with the Zod superRefine, which sees only the patch). A patch
    touching only one side of the pair is rejected here and must send
    both — the handler additionally validates the merged state
    (refine_service_merged_state), so the final entity is checked
    twice."""
    m = _raw(body)
    _trim_service_keys(m)
    out, e = _decode_collect(gen.UpdateServiceInput, m, "UpdateServiceInput")
    if out is not None and out.photoUrl is not None:
        msg = url_rule(str(out.photoUrl))
        if msg:
            e.add("photoUrl", msg)
    if out is not None:
        refine_service_options(e, out.options, out.optionsSelectMode)
    if out is None:
        raise ValidationFailed(e)
    return _finish(out, e)


def decode_merged_service_input(merged: bytes) -> gen.UpdateServiceInput:
    m = _raw(merged)
    _trim_service_keys(m)
    out, e = _decode_collect(gen.UpdateServiceInput, m, "UpdateServiceInput")
    if out is not None:
        if out.photoUrl is not None:
            msg = url_rule(str(out.photoUrl))
            if msg:
                e.add("photoUrl", msg)
        refine_service_merged_state(e, out)
    if out is None:
        raise ValidationFailed(e)
    return _finish(out, e)
