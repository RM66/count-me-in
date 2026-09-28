"""The shared decode skeleton: spec-driven model validation
with the API's pinned error messages, the UUID-pattern fallback, and the
raw-body/finish plumbing every entity decoder builds on.
"""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, TypeAdapter, ValidationError

from ...errors import ValidationFailed
from ..errors import Errors, form_errors
from ..transforms import raw_object


def _issue_reason(err: Any) -> str:
    """Translate a Pydantic issue into the Reason the API answers with
    (the retired implementation's schemaErrReason) — the parity goldens
    pin the exact strings."""
    import json as _json

    t = err.get("type")
    ctx = err.get("ctx") or {}
    if t == "missing":
        return "Required"
    if t == "string_too_short":
        return f"minimum string length is {ctx.get('min_length')}"
    if t == "literal_error":
        # Pydantic renders expected as "'a', 'b' or 'c'" — the spec decode
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
    fails the spec pattern gets the spec pattern message (the
    parity goldens pin the exact text, pattern verbatim). Returns True
    when the property refs a `format: uuid` schema and the check ran."""
    import re

    from .. import spec

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
    from .. import spec

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
            msg = _issue_reason(err)
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
            # here — a string that fails it gets the spec pattern
            # message (the parity goldens pin the exact text).
            if _uuid_pattern_check(schema_name, key, value, e):
                continue
            try:
                # Annotated[...] carries the constraints; FieldInfo.annotation
                # alone is the bare type (metadata would be silently skipped).
                # Annotated[X] with no metadata is invalid — use the bare type.
                field_type: Any = fields[key].annotation
                if fields[key].metadata:
                    field_type = Annotated[(field_type, *fields[key].metadata)]
                TypeAdapter(field_type).validate_python(value)
            except ValidationError as exc2:
                for err in exc2.errors():
                    e.add(key, _issue_reason(err))
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


def _decode_model[T: BaseModel](
    model_cls: type[T], m: dict[str, Any], schema_name: str, *, issues: bool = False
) -> T:
    """Validate m and return the model — the one epilogue every entity
    decoder funnels through: ValidationFailed on any spec error, the
    unreachable-None guard kept explicit (python -O must not strip it)."""
    out, errs = _validate_model(model_cls, m, schema_name)
    if errs is not None:
        raise ValidationFailed(errs, issues=issues)
    if out is None:
        # Unreachable by the decode/guard contract; a real None here is
        # a bug, and python -O must not strip the check.
        raise RuntimeError("out is None after its error guard")
    return out


def _decode_collect[T: BaseModel](
    model_cls: type[T], m: dict[str, Any], schema_name: str
) -> tuple[T | None, Errors]:
    """decode for the inputs that must report spec errors and refinement
    errors together: the collected field errors are returned even when
    the body also fails model validation (a bad options array still
    yields the optionsSelectMode consistency message). With no spec
    errors a failed validation degrades to a generic form error.

    Invariant: the returned Errors may be non-nil yet empty (validation
    passed) — callers must funnel it through refinements and finish it,
    which is what turns an empty Errors into no error."""
    out, e = _validate_model(model_cls, m, schema_name)
    if e is None:
        e = Errors()
    elif out is None:
        if e.empty():
            e = form_errors("Invalid JSON")
        # Refinements must see the partial value even when spec
        # validation failed (a bad options array still yields the
        # optionsSelectMode consistency message). model_construct
        # builds the model without re-validating, which is exactly
        # that: the fields that parsed are present, the rest default.
        try:
            out = model_cls.model_construct(
                **{k: v for k, v in m.items() if k in model_cls.model_fields and v is not None}
            )
        except Exception:
            out = None
    return out, e


def _raw(body: bytes) -> dict[str, Any]:
    """Parse the JSON object or raise ValidationFailed with the parse
    errors."""
    m, e = raw_object(body)
    if e is not None:
        raise ValidationFailed(e)
    return m or {}


def _finish[T](out: T, e: Errors, *, issues: bool = False) -> T:
    """Turn the collected Errors into the raise-or-return decision."""
    done = e.finish()
    if done is not None:
        raise ValidationFailed(done, issues=issues)
    return out
