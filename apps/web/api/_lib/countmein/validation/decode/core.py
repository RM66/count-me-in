"""The shared decode skeleton (ADR-024 C1): the committed OpenAPI document
IS the request validator — raw dict → declared transforms (rules_gen.py)
→ ``jsonschema`` against ``spec_gen.json`` → declared refinements → DTO
built with ``model_construct`` (safe: the dict is already schema-valid).

The Pydantic-validation layer is gone — JSON Schema answers the
coercion/nullability questions natively. ``_issue_reason`` translates
jsonschema's small error vocabulary into the pinned wire messages (the
parity goldens hold them byte-for-byte); the validation vectors pin the
field keys.
"""

from __future__ import annotations

import json as _json
import re
from typing import Any

from pydantic import BaseModel

from ...errors import ValidationFailed
from ..errors import Errors
from ..rules_gen import RULES
from ..transforms import raw_object

# ── jsonschema-error → wire message translation ─────────────────────────────


def _kind_of_value(v: Any) -> str:
    """The JSON kind name of a parsed value — bool before int
    (isinstance(True, int) trap)."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, str):
        return "string"
    if isinstance(v, (int, float)):
        return "number"
    if isinstance(v, list):
        return "array"
    return "object"


def _issue_reason(err: Any) -> str:
    """Translate a jsonschema error into the Reason the API answers — the
    same strings the goldens pin. Stable vocabulary: required/min/max
    Length, enum/pattern, numeric bounds carry pinned text; the rest
    falls back to a Zod-style type message."""
    v = err.validator
    val = err.validator_value
    if v == "required":
        return "Required"
    if v == "minLength":
        return f"minimum string length is {val}"
    if v == "maxLength":
        return f"maximum string length is {val}"
    if v in ("enum", "const"):
        allowed = val if isinstance(val, list) else [val]
        return "value is not one of the allowed values " + _json.dumps(
            allowed, separators=(",", ":")
        )
    if v == "pattern":
        return f'string doesn\'t match the regular expression "{val}"'
    if v == "minimum":
        return f"number must be at least {val}"
    if v == "exclusiveMinimum":
        return f"number must be greater than {val}"
    if v == "maximum":
        return f"number must be at most {val}"
    if v == "exclusiveMaximum":
        return f"number must be less than {val}"
    if v == "minItems":
        return f"Too small: expected array to have >={val} items"
    if v == "maxItems":
        return f"Too big: expected array to have <={val} items"
    if v == "type":
        if err.instance is None:
            return "Expected non-null value, received null"
        expected = val if isinstance(val, str) else " or ".join(val)
        return f"Invalid input: expected {expected}, received {_kind_of_value(err.instance)}"
    if v == "format":
        return f"Invalid input: expected {val}"
    return err.message or "Invalid input"


_REQUIRED_MSG = re.compile(r"^'([^']+)' is a required property")


def _emit(entries: list[tuple[str | None, str]], err: Any, *, key: str | None = None) -> None:
    """Collect one jsonschema error as a (field, message) pair: missing
    properties land under their own name, combiner failures (oneOf/anyOf)
    recurse into sub-errors at the same key, everything else takes its
    first path segment — object-level issues become form errors (None
    key)."""
    if err.validator == "required":
        m = _REQUIRED_MSG.match(err.message or "")
        name = (
            m.group(1)
            if m
            else next((k for k in err.validator_value if k not in (err.instance or {})), None)
        )
        entries.append((name, "Required"))
        return
    if key is None and err.absolute_path:
        first = err.absolute_path[0]
        if isinstance(first, str):
            key = first
    if err.validator in ("oneOf", "anyOf", "allOf") and err.context:
        subs = err.context
        # A union of plain type alternatives (`X | null`): collapse to
        # one "expected t1 or t2" message — Zod reports the union once.
        if all(s.validator == "type" for s in subs):
            expected: list[str] = []
            for s in subs:
                v = s.validator_value
                expected.extend(v if isinstance(v, list) else [v])
            entries.append(
                (
                    key,
                    f"Invalid input: expected {' or '.join(expected)}, "
                    f"received {_kind_of_value(err.instance)}",
                )
            )
            return
        for sub in subs:
            _emit(entries, sub, key=key)
        return
    entries.append((key, _issue_reason(err)))


def _validate_spec(schema_name: str, m: dict[str, Any]) -> Errors | None:
    """Validate the raw object against the bundled spec — unknown keys
    pass (Zod strips them). fieldErrors are emitted in the spec's
    property-declaration order (the goldens pin the key order)."""
    from .. import spec

    entries: list[tuple[str | None, str]] = []
    for err in spec.validator(schema_name).iter_errors(m):
        _emit(entries, err)
    if not entries:
        return None
    order = {name: i for i, name in enumerate(spec.property_order(schema_name))}
    entries.sort(key=lambda kv: order.get(kv[0], len(order)) if kv[0] else len(order))
    e = Errors()
    for key, msg in entries:
        if key is None:
            e.add_form(msg)
        else:
            e.add(key, msg)
    return e


# ── Declared transforms / rules (validation/rules_gen.py, ADR-024 C2) ────────


def _apply_transforms(transforms: Any, m: dict[str, Any]) -> None:
    from ..transforms import js_trim, lower_key

    for key, names in (transforms or {}).items():
        for name in names:
            if name == "trim" and key in m:
                v = m[key]
                if isinstance(v, str):
                    m[key] = js_trim(v)
                elif isinstance(v, list):
                    m[key] = [js_trim(i) if isinstance(i, str) else i for i in v]
            elif name == "lowercase":
                lower_key(m, key)


def _run_field_rules(rules: Any, out: Any, e: Errors, *, touched: set[str] | None) -> None:
    from .. import refine
    from ..rules import is_reserved_slug, timezone_rule, url_rule

    for field, names in (rules or {}).items():
        v = getattr(out, field, None)
        if v is None:
            continue
        for name in names:
            if name == "ianaTimezone":
                msg = timezone_rule(str(v))
                if msg:
                    e.add(field, msg)
            elif name == "slugNotReserved":
                if is_reserved_slug(str(v)):
                    e.add(field, "this slug is reserved for system use — please choose another")
            elif name == "httpUrl":
                msg = url_rule(str(v))
                if msg:
                    e.add(field, msg)
            elif name == "startsAtNotPast":
                # In merged-state decode the current startsAt always rides
                # along — the rule fires only when the patch touched it.
                if touched is None or field in touched:
                    refine.refine_slot_start(e, v)
            else:  # pragma: no cover - generated vocabulary drift
                raise RuntimeError(f"unknown field rule {name!r}")


def _run_refinements(refinements: Any, out: Any, e: Errors) -> None:
    from .. import refine

    for name in refinements or []:
        if name == "optionsPair":
            refine.refine_service_options(e, out.options, out.optionsSelectMode)
        else:  # pragma: no cover - generated vocabulary drift
            raise RuntimeError(f"unknown refinement {name!r}")


def _construct[T: BaseModel](model_cls: type[T], m: dict[str, Any]) -> T:
    """The DTO: model_construct over the schema-valid dict — unknown
    keys stripped, null-valued keys dropped (a patch null on a
    non-nullable field must surface as missing, not a coerced None)."""
    fields = model_cls.model_fields
    return model_cls.model_construct(
        **{k: v for k, v in m.items() if k in fields and v is not None}
    )


def _order_fields(e: Errors, schema_name: str) -> None:
    """fieldErrors in spec declaration order — the same order spec errors
    are emitted in, so rule/merged-required errors join canonically (the
    wire pins the key order)."""
    if len(e.fields) < 2:
        return
    from .. import spec

    order = {name: i for i, name in enumerate(spec.property_order(schema_name))}
    e.fields = dict(sorted(e.fields.items(), key=lambda kv: order.get(kv[0], len(order))))


def _decode[T: BaseModel](
    model_cls: type[T], schema_name: str, m: dict[str, Any], *, merged_touched: set[str] | None
) -> T:
    """raw object → transforms → jsonschema → rules → DTO.
    ``merged_touched`` is the patch's key set for merged-state decoders
    (gates startsAtNotPast); None otherwise."""
    meta = RULES.get(schema_name, {})
    _apply_transforms(meta.get("transforms"), m)
    errs = _validate_spec(schema_name, m)
    e = errs or Errors()
    out = _construct(model_cls, m)
    # Rules see the value only when the schema passed — except schemas
    # declaring refinements, which collect spec + refinement issues
    # together (a bad options array still yields the optionsSelectMode
    # consistency message).
    if errs is None or meta.get("refinements"):
        _run_field_rules(meta.get("fieldRules"), out, e, touched=merged_touched)
        _run_refinements(meta.get("refinements"), out, e)
    _order_fields(e, schema_name)
    return _finish(out, e)


def decode_input[T: BaseModel](model_cls: type[T], schema_name: str, body: bytes) -> T:
    """Wire decode: transforms → schema → field rules → refinements → DTO."""
    return _decode(model_cls, schema_name, _raw(body), merged_touched=None)


def decode_merged[T: BaseModel](
    model_cls: type[T], schema_name: str, merged: bytes, touched: set[str] | None = None
) -> T:
    """Merged-state decode (RFC 7386): the update schema's rules plus
    mergedRequired — keys a patch-null would silently erase."""
    meta = RULES.get(schema_name, {})
    m = _raw(merged)
    _apply_transforms(meta.get("transforms"), m)
    errs = _validate_spec(schema_name, m)
    e = errs or Errors()
    out = _construct(model_cls, m)
    if errs is None or meta.get("refinements"):
        _run_field_rules(meta.get("fieldRules"), out, e, touched=touched)
    for field_name in meta.get("mergedRequired", []):
        if getattr(out, field_name, None) is None:
            e.add(field_name, "Required")
    if errs is None or meta.get("refinements"):
        _run_refinements(meta.get("refinements"), out, e)
    _order_fields(e, schema_name)
    return _finish(out, e)


def _raw(body: bytes) -> dict[str, Any]:
    """Parse the JSON object or raise ValidationFailed with the parse
    errors."""
    m, e = raw_object(body)
    if e is not None:
        raise ValidationFailed(e)
    return m or {}


def _finish[T](out: T, e: Errors) -> T:
    """Turn the collected Errors into the raise-or-return decision."""
    done = e.finish()
    if done is not None:
        raise ValidationFailed(done)
    return out
