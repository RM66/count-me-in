"""Decode functions (ADR-016): ordinary hand-written code, one per wire
input. Each applies the Zod transforms the spec cannot express (trim,
slug lowercasing), validates the body against the generated Pydantic
model (collecting one message per field, z.flattenError parity), then
runs the hand-written refinements (refine.py). Parity is pinned by
packages/contracts/vectors/validation/*.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, TypeAdapter, ValidationError

from ..contracts import models_gen as gen
from .errors import Errors, form_errors, raw_object
from .refine import (
    refine_service_merged_state,
    refine_service_options,
    refine_slot_merged_state,
    refine_slot_start,
)
from .rules import is_reserved_slug, timezone_rule, url_rule


def _go_message(err: Any) -> str:
    """Translate a Pydantic issue into the kin-openapi Reason the Go API
    answers with (spec.go schemaErrReason) — the parity goldens pin the
    exact strings."""
    import json as _json

    t = err.get("type")
    ctx = err.get("ctx") or {}
    if t == "missing":
        return "Required"
    if t == "string_too_short":
        return f"minimum string length is {ctx.get('min_length')}"
    if t == "literal_error":
        # Pydantic renders expected as "'a', 'b' or 'c'" — kin-openapi
        # answers with the JSON array of allowed values.
        raw = str(ctx.get("expected") or "").replace(" or ", ", ")
        expected = [part.strip().strip("'\"") for part in raw.split(", ") if part.strip()]
        return "value is not one of the allowed values " + _json.dumps(
            expected, separators=(",", ":")
        )
    if t == "string_pattern_mismatch":
        return f'string doesn\'t match the regular expression "{ctx.get("pattern")}"'
    if t == "greater_than_equal":
        return f"number must be at least {ctx.get('ge')}"
    if t == "greater_than":
        return f"number must be greater than {ctx.get('gt')}"
    if t == "less_than_equal":
        return f"number must be at most {ctx.get('le')}"
    if t == "less_than":
        return f"number must be less than {ctx.get('lt')}"
    return err.get("msg") or "Invalid input"


def _uuid_pattern_check(schema_name: str, key: str, value: Any, e: Errors) -> bool:
    """UUID-typed properties: Pydantic cannot apply the generated pattern
    constraint to a coerced UUID, so the check lives here — a string that
    fails the spec pattern gets kin-openapi's pattern message (the
    parity goldens pin the exact text, pattern verbatim). Returns True
    when the property refs a `format: uuid` schema and the check ran."""
    import re

    from . import spec

    ref = spec.property_ref(schema_name, key)
    if ref is None or spec.schema_format(ref) != "uuid":
        return False
    if not isinstance(value, str):
        return False  # non-strings are not pinned by the goldens
    pattern = spec.schema_pattern(ref)
    if pattern and not re.fullmatch(pattern, value):
        e.add(key, f'string doesn\'t match the regular expression "{pattern}"')
    return True


def _validate_model[T: BaseModel](
    model_cls: type[T], m: dict[str, Any], schema_name: str
) -> tuple[T | None, Errors | None]:
    """Validate m against the generated model, collecting every issue
    keyed like z.flattenError's fieldErrors: missing required keys and
    per-property failures under the property name, everything else as
    form errors. Unknown keys are ignored — Zod strips them, and the
    spec deliberately carries no additionalProperties:false.

    Explicit null on a non-nullable key is rejected first, from the
    spec's nullability encoding (anyOf with {type: null}) — Pydantic's
    `X | None` default would silently accept it."""
    from . import spec

    e = Errors()
    for mkey, value in m.items():
        if value is None and not spec.is_nullable(schema_name, mkey):
            e.add(mkey, "Expected non-null value, received null")
    try:
        out = model_cls.model_validate(m)
    except ValidationError as exc:
        for err in exc.errors():
            loc = err.get("loc") or ()
            first = loc[0] if loc else None
            key: str | None = first if isinstance(first, str) else None
            msg = _go_message(err)
            if key is None or not isinstance(key, str):
                e.add_form(msg)
            else:
                e.add(key, msg)
        return None, e
    except TypeError:
        # The generated UUID models carry a pattern constraint that
        # Pydantic cannot apply to a coerced UUID value. Fall back to
        # per-field validation: each present key against its annotation
        # (a constraint-application TypeError on one field means the
        # format check already passed — UUID coercion is the check),
        # missing required keys from the spec.
        for name in spec.required_keys(schema_name):
            if name not in m:
                e.add(name, "Required")
        fields = model_cls.model_fields
        for key, value in m.items():
            if key not in fields:
                continue  # unknown key: stripped, like Zod
            # UUID-typed properties: Pydantic cannot apply the generated
            # pattern to a coerced UUID, so the spec pattern is checked
            # here — a string that fails it gets kin-openapi's pattern
            # message (the parity goldens pin the exact text).
            if _uuid_pattern_check(schema_name, key, value, e):
                continue
            try:
                TypeAdapter(fields[key].annotation).validate_python(value)
            except ValidationError as exc2:
                for err in exc2.errors():
                    e.add(key, _go_message(err))
            except TypeError:
                pass  # constraint not applicable to the coerced type
        if not e.empty():
            return None, e
        # Construct without re-validating: the per-field pass above is
        # the validation (the pattern constraint is unapplicable to the
        # coerced UUID type — coercion itself is the format check).
        return model_cls.model_construct(**m), None
    if not e.empty():
        return None, e
    return out, None


def _decode[T: BaseModel](
    model_cls: type[T], m: dict[str, Any], schema_name: str
) -> tuple[T | None, Errors | None]:
    """The shared skeleton: validate m against the model, return None
    errors when valid."""
    return _validate_model(model_cls, m, schema_name)


def _decode_collect[T: BaseModel](
    model_cls: type[T], m: dict[str, Any], schema_name: str
) -> tuple[T | None, Errors]:
    """decode for the inputs that must report spec errors and refinement
    errors together: the collected field errors are returned even when
    the body also fails model validation (a bad options array still
    yields the optionsSelectMode consistency message). With no spec
    errors a failed validation degrades to a generic form error.

    Invariant: the returned Errors may be non-nil yet empty (validation
    passed) — callers must funnel it through refinements and return
    e.finish(), which is what turns an empty Errors into None."""
    out, e = _validate_model(model_cls, m, schema_name)
    if e is None:
        e = Errors()
    elif out is None:
        if e.empty():
            e = form_errors("Invalid JSON")
        # Go's decodeCollect still unmarshals into out when spec
        # validation failed, so refinements see the partial value (a
        # bad options array still yields the optionsSelectMode
        # consistency message). model_construct mirrors that without
        # re-validating.
        try:
            out = model_cls.model_construct(
                **{k: v for k, v in m.items() if k in model_cls.model_fields and v is not None}
            )
        except Exception:
            out = None
    return out, e


def _root(value: Any) -> Any:
    """Unwrap RootModel values recursively (slug, timezone, photoUrl are
    all RootModel wrappers)."""
    while hasattr(value, "root"):
        value = value.root
    return value


# ── Bookings ─────────────────────────────────────────────────────────────────


def _raw(body: bytes) -> tuple[dict[str, Any], Errors | None]:
    """raw_object with the None arm folded away: callers return the
    error before ever touching the (empty) dict."""
    m, e = raw_object(body)
    return m or {}, e


def decode_create_booking_input(body: bytes) -> tuple[gen.CreateBookingInput | None, Errors | None]:
    m, e = _raw(body)
    if e is not None:
        return None, e
    from .errors import trim_key

    trim_key(m, "guestName")
    trim_key(m, "selectedOptions")
    out, errs = _decode(gen.CreateBookingInput, m, "CreateBookingInput")
    if errs is not None:
        return None, errs
    assert out is not None
    return out, None


def decode_cancel_booking_by_token_input(
    body: bytes,
) -> tuple[gen.CancelBookingByTokenInput | None, Errors | None]:
    m, e = _raw(body)
    if e is not None:
        return None, e
    return _decode(gen.CancelBookingByTokenInput, m, "CancelBookingByTokenInput")


def decode_lookup_bookings_input(
    body: bytes,
) -> tuple[gen.LookupBookingsInput | None, Errors | None]:
    m, e = _raw(body)
    if e is not None:
        return None, e
    return _decode(gen.LookupBookingsInput, m, "LookupBookingsInput")


def decode_cancel_booking_by_organizer_input(
    body: bytes,
) -> tuple[gen.CancelBookingByOrganizerInput | None, Errors | None]:
    m, e = _raw(body)
    if e is not None:
        return None, e
    return _decode(gen.CancelBookingByOrganizerInput, m, "CancelBookingByOrganizerInput")


# ── Services ─────────────────────────────────────────────────────────────────


def _trim_service_keys(m: dict[str, Any]) -> None:
    from .errors import trim_key

    for key in ("title", "description", "location", "contact", "defaultPrice", "options"):
        trim_key(m, key)


def decode_create_service_input(
    body: bytes,
) -> tuple[gen.CreateServiceInput | None, Errors | None]:
    m, e = _raw(body)
    if e is not None:
        return None, e
    _trim_service_keys(m)
    out, e = _decode_collect(gen.CreateServiceInput, m, "CreateServiceInput")
    if out is not None and out.photoUrl is not None:
        msg = url_rule(str(_root(out.photoUrl)))
        if msg:
            e.add("photoUrl", msg)
    if out is not None:
        refine_service_options(e, out.options, out.optionsSelectMode)
    return out, e.finish()


def decode_update_service_input(
    body: bytes,
) -> tuple[gen.UpdateServiceInput | None, Errors | None]:
    """Validate a merge-patch document against the update schema,
    including the options/mode pair check on the patch itself (parity
    with the Zod superRefine, which sees only the patch). A patch
    touching only one side of the pair is rejected here and must send
    both — the handler additionally validates the merged state
    (refine_service_merged_state), so the final entity is checked
    twice."""
    m, e = _raw(body)
    if e is not None:
        return None, e
    _trim_service_keys(m)
    out, e = _decode_collect(gen.UpdateServiceInput, m, "UpdateServiceInput")
    if out is not None and out.photoUrl is not None:
        msg = url_rule(str(_root(out.photoUrl)))
        if msg:
            e.add("photoUrl", msg)
    if out is not None:
        refine_service_options(e, out.options, out.optionsSelectMode)
    return out, e.finish()


# ── Time slots ────────────────────────────────────────────────────────────────


def decode_create_time_slot_input(
    body: bytes,
) -> tuple[gen.CreateTimeSlotInput | None, Errors | None]:
    m, e = _raw(body)
    if e is not None:
        return None, e
    from .errors import trim_key

    trim_key(m, "price")
    out, errs = _decode(gen.CreateTimeSlotInput, m, "CreateTimeSlotInput")
    if errs is not None:
        return None, errs
    assert out is not None
    e = Errors()
    refine_slot_start(e, out.startsAt)
    return out, e.finish()


def decode_update_time_slot_input(
    body: bytes,
) -> tuple[gen.UpdateTimeSlotInput | None, Errors | None]:
    m, e = _raw(body)
    if e is not None:
        return None, e
    from .errors import trim_key

    trim_key(m, "price")
    out, errs = _decode(gen.UpdateTimeSlotInput, m, "UpdateTimeSlotInput")
    if errs is not None:
        return None, errs
    assert out is not None
    e = Errors()
    if out.startsAt is not None:
        refine_slot_start(e, out.startsAt)
    return out, e.finish()


# ── Organizers ─────────────────────────────────────────────────────────────────


def decode_register_organizer_input(
    body: bytes,
) -> tuple[gen.RegisterOrganizerInput | None, Errors | None]:
    m, e = _raw(body)
    if e is not None:
        return None, e
    from .errors import lower_key, trim_key

    trim_key(m, "slug")
    lower_key(m, "slug")
    trim_key(m, "name")
    trim_key(m, "contact")
    out, errs = _decode(gen.RegisterOrganizerInput, m, "RegisterOrganizerInput")
    if errs is not None:
        return None, errs
    assert out is not None
    e = Errors()
    msg = timezone_rule(str(_root(out.timezone)))
    if msg:
        e.add("timezone", msg)
    if is_reserved_slug(str(_root(out.slug))):
        e.add("slug", "this slug is reserved for system use — please choose another")
    return out, e.finish()


def decode_update_organizer_profile_input(
    body: bytes,
) -> tuple[gen.UpdateOrganizerProfileInput | None, Errors | None]:
    m, e = _raw(body)
    if e is not None:
        return None, e
    from .errors import lower_key, trim_key

    trim_key(m, "slug")
    lower_key(m, "slug")
    for key in ("name", "description", "location", "contact"):
        trim_key(m, key)
    out, errs = _decode(gen.UpdateOrganizerProfileInput, m, "UpdateOrganizerProfileInput")
    if errs is not None:
        return None, errs
    assert out is not None
    e = Errors()
    if out.timezone is not None:
        msg = timezone_rule(str(_root(out.timezone)))
        if msg:
            e.add("timezone", msg)
    if out.slug is not None and is_reserved_slug(str(_root(out.slug))):
        e.add("slug", "this slug is reserved for system use — please choose another")
    if out.photoUrl is not None:
        msg = url_rule(str(_root(out.photoUrl)))
        if msg:
            e.add("photoUrl", msg)
    return out, e.finish()


def decode_update_organizer_language_input(
    body: bytes,
) -> tuple[gen.UpdateOrganizerLanguageInput | None, Errors | None]:
    m, e = _raw(body)
    if e is not None:
        return None, e
    return _decode(gen.UpdateOrganizerLanguageInput, m, "UpdateOrganizerLanguageInput")


def decode_create_avatar_upload_input(
    body: bytes,
) -> tuple[gen.CreateAvatarUploadInput | None, Errors | None]:
    m, e = _raw(body)
    if e is not None:
        return None, e
    return _decode(gen.CreateAvatarUploadInput, m, "CreateAvatarUploadInput")


def decode_create_service_photo_upload_input(
    body: bytes,
) -> tuple[gen.CreateServicePhotoUploadInput | None, Errors | None]:
    m, e = _raw(body)
    if e is not None:
        return None, e
    return _decode(gen.CreateServicePhotoUploadInput, m, "CreateServicePhotoUploadInput")


# ── Telegram widget ──────────────────────────────────────────────────────────


def decode_telegram_widget_payload(
    body: bytes,
) -> tuple[gen.TelegramWidgetPayload | None, Errors | None]:
    m, e = _raw(body)
    if e is not None:
        return None, e
    out, errs = _decode(gen.TelegramWidgetPayload, m, "TelegramWidgetPayload")
    if errs is not None:
        return None, errs
    assert out is not None
    e = Errors()
    if out.photo_url is not None:
        msg = url_rule(str(_root(out.photo_url)))
        if msg:
            e.add("photo_url", msg)
    return out, e.finish()


# ── Merge-patch merged-state decoders (ADR-016, Phase 4) ─────────────────────
#
# The three partial-update endpoints validate the *merged* state
# (current + patch, RFC 7386), not the patch alone: bounds apply to the
# final state, and cross-field rules (options/mode consistency) see the
# whole entity. The patch itself is still validated first by the
# ordinary decode_* functions, so a null on a non-nullable key is
# rejected before the merge ever runs.


def decode_merged_service_input(
    merged: bytes,
) -> tuple[gen.UpdateServiceInput | None, Errors | None]:
    m, e = _raw(merged)
    if e is not None:
        return None, e
    _trim_service_keys(m)
    out, e = _decode_collect(gen.UpdateServiceInput, m, "UpdateServiceInput")
    if out is not None:
        if out.photoUrl is not None:
            msg = url_rule(str(_root(out.photoUrl)))
            if msg:
                e.add("photoUrl", msg)
        refine_service_merged_state(e, out)
    return out, e.finish()


def decode_merged_organizer_input(
    merged: bytes,
) -> tuple[gen.UpdateOrganizerProfileInput | None, Errors | None]:
    m, e = _raw(merged)
    if e is not None:
        return None, e
    from .errors import lower_key, trim_key

    trim_key(m, "slug")
    lower_key(m, "slug")
    for key in ("name", "description", "location", "contact"):
        trim_key(m, key)
    out, errs = _decode(gen.UpdateOrganizerProfileInput, m, "UpdateOrganizerProfileInput")
    if errs is not None:
        return None, errs
    assert out is not None
    e = Errors()
    from .refine import refine_organizer_merged_state

    refine_organizer_merged_state(e, out)
    if out.timezone is not None:
        msg = timezone_rule(str(_root(out.timezone)))
        if msg:
            e.add("timezone", msg)
    if out.slug is not None and is_reserved_slug(str(_root(out.slug))):
        e.add("slug", "this slug is reserved for system use — please choose another")
    if out.photoUrl is not None:
        msg = url_rule(str(_root(out.photoUrl)))
        if msg:
            e.add("photoUrl", msg)
    return out, e.finish()


def decode_merged_slot_input(
    merged: bytes, starts_at_touched: bool
) -> tuple[gen.UpdateTimeSlotInput | None, Errors | None]:
    """Validate a merged slot state; startsAt is only checked against
    the past when the patch touched it (the merged state always carries
    the current value, which may legitimately be past)."""
    m, e = _raw(merged)
    if e is not None:
        return None, e
    from .errors import trim_key

    trim_key(m, "price")
    out, errs = _decode(gen.UpdateTimeSlotInput, m, "UpdateTimeSlotInput")
    if errs is not None:
        return None, errs
    assert out is not None
    e = Errors()
    refine_slot_merged_state(e, out, starts_at_touched)
    return out, e.finish()


# ── Vectors dispatch ─────────────────────────────────────────────────────────
#
# Schema dispatch for the parity vectors — a new input works in the
# vectors with no test edit: add its decode_* here under its wire id.

DECODERS = {
    "CreateBookingInput": decode_create_booking_input,
    "CancelBookingByTokenInput": decode_cancel_booking_by_token_input,
    "LookupBookingsInput": decode_lookup_bookings_input,
    "CancelBookingByOrganizerInput": decode_cancel_booking_by_organizer_input,
    "CreateServiceInput": decode_create_service_input,
    "UpdateServiceInput": decode_update_service_input,
    "CreateTimeSlotInput": decode_create_time_slot_input,
    "UpdateTimeSlotInput": decode_update_time_slot_input,
    "RegisterOrganizerInput": decode_register_organizer_input,
    "UpdateOrganizerProfileInput": decode_update_organizer_profile_input,
    "UpdateOrganizerLanguageInput": decode_update_organizer_language_input,
    "CreateAvatarUploadInput": decode_create_avatar_upload_input,
    "CreateServicePhotoUploadInput": decode_create_service_photo_upload_input,
    "TelegramWidgetPayload": decode_telegram_widget_payload,
}
