"""The bundled OpenAPI artifact (ADR-024 A2): spec_gen.json is the
runtime authority for the constraints the generated models cannot
express. It is generated, committed, and bundled into the Vercel
function — the loader must fail closed when it is missing or malformed,
never degrade to permissive defaults.
"""

import json
from pathlib import Path

import pytest
from countmein.validation import spec

_SPEC_FILE = Path(__file__).resolve().parents[2] / "api/_lib/countmein/contracts/spec_gen.json"


def test_spec_gen_json_is_committed_and_wellformed():
    doc = json.loads(_SPEC_FILE.read_text())
    assert doc["openapi"].startswith("3.")
    schemas = doc["components"]["schemas"]
    # The request-input schemas the decoders probe must all be present.
    for name in (
        "CreateBookingInput",
        "CreateServiceInput",
        "UpdateServiceInput",
        "CreateTimeSlotInput",
        "UpdateTimeSlotInput",
        "RegisterOrganizerInput",
        "UpdateOrganizerProfileInput",
        "ErrorBody",
    ):
        assert name in schemas, name


def test_spec_gen_matches_openapi_yaml():
    """The two artifacts render the same document — drift means someone
    regenerated one without the other."""
    import yaml

    yaml_doc = yaml.safe_load((Path(__file__).resolve().parents[2] / "openapi.yaml").read_text())
    assert json.loads(_SPEC_FILE.read_text()) == yaml_doc


def test_load_fails_closed_on_missing_spec(monkeypatch):
    monkeypatch.setattr(spec, "_SPEC_PATH", _SPEC_FILE.with_name("gone.json"))
    spec._load.cache_clear()
    try:
        with pytest.raises(RuntimeError, match="bundled OpenAPI spec"):
            spec._load()
    finally:
        spec._load.cache_clear()


def test_load_fails_closed_on_malformed_spec(monkeypatch, tmp_path):
    bad = tmp_path / "spec_gen.json"
    bad.write_text('{"not": "openapi"}')
    monkeypatch.setattr(spec, "_SPEC_PATH", bad)
    spec._load.cache_clear()
    try:
        with pytest.raises(RuntimeError, match="malformed"):
            spec._load()
    finally:
        spec._load.cache_clear()


def test_unknown_schema_name_raises():
    """A schema name absent from the spec is a programming error, not a
    reason to accept everything."""
    with pytest.raises(RuntimeError, match="Nope"):
        spec.validator("Nope")
    with pytest.raises(RuntimeError, match="Nope"):
        spec.property_order("Nope")


def test_validator_is_the_schema_authority():
    """ADR-024 C1: the bundled document itself validates — required,
    types, and $ref'd primitives all come from it."""
    v = spec.validator("CreateBookingInput")
    assert list(v.iter_errors({"seats": 1})), "missing required keys must fail"
    assert list(
        v.iter_errors(
            {
                "seats": 1,
                "serviceId": 123,
                "timeSlotId": "x",
                "guestName": "a",
                "guestTicket": "t" * 20,
            }
        )
    ), "a wrong-typed $ref'd property must fail"
    assert not list(
        v.iter_errors(
            {
                "serviceId": "demo-yoga",
                "timeSlotId": "01930000-0000-7000-8000-000000000001",
                "seats": 1,
                "guestName": "Ann",
                "guestTicket": "t" * 20,
                "unknownKey": "stripped like Zod",
            }
        )
    ), "a valid body with an unknown key must pass"
