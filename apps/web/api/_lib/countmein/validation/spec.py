"""Spec-driven validation (ADR-016/024): the bundled OpenAPI document
(rendered from the same Zod registry as the models, committed as
``contracts/spec_gen.json``) is the authority for everything the
generated Pydantic models cannot say — chiefly explicit-null rejection:
a property whose schema carries no ``{type: null}`` variant must refuse
JSON null, while Pydantic's ``X | None`` default would silently accept
it.

The document is parsed once, lazily, and cached for the process
lifetime. The artifact is generated, committed, and bundled with the
function (``vercel.json`` includeFiles covers ``api/_lib/**``), so a
missing or unreadable spec is a deployment bug — the loader fails
closed and loud rather than letting requests through unvalidated.
"""

from __future__ import annotations

import functools
import json
from pathlib import Path
from typing import Any

_SPEC_PATH = Path(__file__).resolve().parents[1] / "contracts" / "spec_gen.json"


@functools.cache
def _load() -> dict[str, Any]:
    try:
        doc = json.loads(_SPEC_PATH.read_text())
    except Exception as err:  # pragma: no cover - generated+committed+bundled
        raise RuntimeError(f"cannot load the bundled OpenAPI spec at {_SPEC_PATH}: {err}") from err
    if not isinstance(doc, dict) or "components" not in doc:
        raise RuntimeError(f"bundled OpenAPI spec at {_SPEC_PATH} is malformed")
    return doc


def _schema(name: str) -> dict[str, Any]:
    s = _load().get("components", {}).get("schemas", {}).get(name)
    if s is None:
        raise RuntimeError(f"schema {name!r} not in the bundled OpenAPI spec")
    return s  # type: ignore[no-any-return]


def property_order(schema_name: str) -> list[str]:
    """The declared property order — used to emit fieldErrors in the same
    order the old Pydantic pipeline produced (the parity goldens pin the
    key order byte-for-byte)."""
    return list(_schema(schema_name).get("properties", {}).keys())


# ── The spec as validator (ADR-024 C1) ───────────────────────────────────────

_SPEC_URI = "urn:countmein:spec"


@functools.cache
def _registry() -> Any:
    """The bundled document as a referencing resource — named-schema
    validators resolve their internal $refs against it."""
    from referencing import Registry, Resource
    from referencing.jsonschema import DRAFT202012

    return Registry().with_resource(
        _SPEC_URI, Resource.from_contents(_load(), default_specification=DRAFT202012)
    )


@functools.cache
def _format_checker() -> Any:
    """Only date-time is asserted: uuid is pinned by its spec pattern and
    uri by the declared httpUrl field rule — enabling the other registered
    formats would double-report (pattern + format) where the goldens pin
    one message."""
    from datetime import datetime as _dt

    from jsonschema import FormatChecker

    fc = FormatChecker(formats=())

    @fc.checks("date-time", raises=(ValueError, OverflowError))
    def _is_rfc3339_with_offset(v: Any) -> bool:
        if not isinstance(v, str):
            return True  # the type keyword owns non-strings
        s = v[:-1] + "+00:00" if v.endswith("Z") else v
        if _dt.fromisoformat(s).tzinfo is None:
            raise ValueError("date-time must carry an offset (Zod iso.datetime)")
        return True

    return fc


@functools.cache
def validator(schema_name: str) -> Any:
    """A cached Draft2020-12 validator over one components.schemas entry —
    the request-validation authority."""
    import jsonschema

    _schema(schema_name)  # fail closed on an unknown name
    return jsonschema.Draft202012Validator(
        {"$ref": f"{_SPEC_URI}#/components/schemas/{schema_name}"},
        registry=_registry(),
        format_checker=_format_checker(),
    )
