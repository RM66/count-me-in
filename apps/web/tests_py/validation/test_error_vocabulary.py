"""Drift guard for the jsonschema→wire-message translation
(`validation/decode/core.py::_issue_reason` + `_emit`).

_issue_reason covers a fixed keyword set; anything else falls back to
raw ``err.message`` — jsonschema's own wording, which the goldens do
not pin. A schema gaining an unknown keyword (``uniqueItems``,
``contains``, ``propertyNames``, …) would silently change the error
dialect.

This test walks every keyword reachable from the request-input schemas
(``DECODERS`` roots + the job-payload schemas) and asserts each is
either translated by _issue_reason, recursed by _emit, or a pure
applicator that only descends and never surfaces as ``err.validator``.
A new keyword in wire.ts fails this test loudly instead of shipping a
message-format regression.
"""

import json
from pathlib import Path

import jsonschema
from countmein.validation.decode import DECODERS

_SPEC_FILE = Path(__file__).resolve().parents[2] / "api/_lib/countmein/contracts/spec_gen.json"

# Job payloads are spec-validated too (jobs/run.py::_spec_check) — the
# queue names live there, so keep this list next to the schemas it uses.
_JOB_SCHEMAS = ("BookingCreatedJob", "BookingCancelledJob")

# err.validator values _issue_reason translates into the pinned wire
# messages. If a new keyword belongs here, add its translation first.
TRANSLATED = {
    "required",
    "minLength",
    "maxLength",
    "enum",
    "const",
    "pattern",
    "minimum",
    "exclusiveMinimum",
    "maximum",
    "exclusiveMaximum",
    "minItems",
    "maxItems",
    "type",
    "format",
}

# err.validator values _emit recurses into (.context sub-errors).
COMBINERS = {"oneOf", "anyOf", "allOf"}

# Keywords that only descend into child schemas — their failures
# surface as the child's own validator, never under this name.
APPLICATORS = {"$ref", "properties", "items", "prefixItems"}

COVERED = TRANSLATED | COMBINERS | APPLICATORS


def _reachable_keywords(schemas: dict, roots: list[str]) -> set[str]:  # type: ignore[type-arg]
    """Validator keywords reachable from the named schemas, following
    internal $refs. ``jsonschema.Draft202012Validator.VALIDATORS`` is the
    authority for which dict keys are validators at all."""
    validators = set(jsonschema.Draft202012Validator.VALIDATORS)
    used: set[str] = set()

    def walk(node: object, seen: set[str]) -> None:
        if isinstance(node, dict):
            ref = node.get("$ref")
            if isinstance(ref, str):
                name = ref.rsplit("/", 1)[-1]
                if name not in seen:
                    seen.add(name)
                    walk(schemas.get(name, {}), seen)
            for key, value in node.items():
                if key in validators:
                    used.add(key)
                walk(value, seen)
        elif isinstance(node, list):
            for item in node:
                walk(item, seen)

    for root in roots:
        walk(schemas.get(root, {}), set())
    return used


def test_issue_reason_covers_the_reachable_validator_vocabulary():
    doc = json.loads(_SPEC_FILE.read_text())
    schemas = doc["components"]["schemas"]
    roots = sorted(DECODERS) + list(_JOB_SCHEMAS)
    for root in roots:
        assert root in schemas, f"decoder root {root!r} missing from spec_gen.json"
    uncovered = _reachable_keywords(schemas, roots) - COVERED
    assert not uncovered, (
        f"spec uses jsonschema keywords with no pinned translation: "
        f"{sorted(uncovered)} — extend _issue_reason/_emit (and this "
        f"test's vocabulary) or the error text silently becomes "
        f"jsonschema's own wording"
    )


def test_vocabulary_lists_match_the_translator():
    """The COVERED set above must stay honest: every TRANSLATED name
    must appear in _issue_reason's source as a handled branch."""
    import inspect

    from countmein.validation.decode import core

    src = inspect.getsource(core._issue_reason) + inspect.getsource(core._emit)
    for name in TRANSLATED:
        assert f'"{name}"' in src or f"'{name}'" in src, (
            f"{name!r} is declared handled but appears in neither "
            f"_issue_reason nor _emit — the vocabulary lists drifted"
        )
    for name in COMBINERS:
        assert f'"{name}"' in inspect.getsource(core._emit), (
            f"{name!r} is declared a combiner but _emit does not recurse it"
        )
