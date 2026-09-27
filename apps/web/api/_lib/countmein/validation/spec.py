"""Spec-driven validation (ADR-016): the committed OpenAPI document
(rendered from the same Zod registry as the models) is the authority
for everything the generated Pydantic models cannot say — chiefly
explicit-null rejection: a property whose schema carries no
`{type: null}` variant must refuse JSON null, while Pydantic's
`X | None` default would silently accept it.

The document is parsed once, lazily, and cached for the process
lifetime. Failing to load is a programming error (the spec is
generated and committed); callers treat that as "cannot validate" and
fail loudly.
"""

from __future__ import annotations

import functools
from pathlib import Path
from typing import Any

_SPEC_PATH = Path(__file__).resolve().parents[4] / "openapi.yaml"


@functools.cache
def _load() -> dict[str, Any] | None:
    try:
        import yaml

        return yaml.safe_load(_SPEC_PATH.read_text())  # type: ignore[no-any-return]
    except Exception:  # pragma: no cover - generated+committed
        return None


def _schema(name: str) -> dict[str, Any] | None:
    doc = _load()
    if doc is None:
        return None
    return doc.get("components", {}).get("schemas", {}).get(name)  # type: ignore[no-any-return]


def required_keys(schema_name: str) -> list[str]:
    s = _schema(schema_name)
    if s is None:
        return []
    return list(s.get("required", []))


def is_nullable(schema_name: str, key: str) -> bool:
    """True when the property's schema carries an explicit null variant
    (anyOf/oneOf with {type: null}). A plain $ref or type without the
    variant must reject JSON null."""
    s = _schema(schema_name)
    if s is None:
        return True  # cannot validate — do not invent a rejection
    prop = s.get("properties", {}).get(key)
    if prop is None:
        return True  # unknown key: stripped, like Zod
    for combiner in ("anyOf", "oneOf"):
        variants = prop.get(combiner)
        if isinstance(variants, list):
            return any(v.get("type") == "null" for v in variants)
    return prop.get("type") == "null" or ("nullable" in prop and prop["nullable"])


def schema_enum(schema_name: str) -> list[Any] | None:
    """The top-level `enum` of a named schema (RootModel literals)."""
    s = _schema(schema_name)
    if s is None:
        return None
    e = s.get("enum")
    return e if isinstance(e, list) else None


def known_key(schema_name: str, key: str) -> bool:
    s = _schema(schema_name)
    if s is None:
        return True
    return key in s.get("properties", {})


def property_ref(schema_name: str, key: str) -> str | None:
    """The $ref target name of a property ("UUIDModel"), or None when the
    property is inline / unknown."""
    s = _schema(schema_name)
    if s is None:
        return None
    prop = s.get("properties", {}).get(key)
    if not isinstance(prop, dict):
        return None
    ref = prop.get("$ref") or prop.get("allOf", [{}])[0].get("$ref")
    if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
        return ref.rsplit("/", 1)[-1]
    return None


def schema_pattern(schema_name: str) -> str | None:
    """The top-level `pattern` of a named schema (RootModel string
    patterns live there)."""
    s = _schema(schema_name)
    if s is None:
        return None
    p = s.get("pattern")
    return p if isinstance(p, str) else None


def schema_format(schema_name: str) -> str | None:
    """The top-level `format` of a named schema ("uuid" for the shared
    UUID primitive)."""
    s = _schema(schema_name)
    if s is None:
        return None
    f = s.get("format")
    return f if isinstance(f, str) else None
