"""The RFC 7386 merge, the field tables the touched set is derived
from, and the merge base a row projects."""

import json
from datetime import UTC, datetime

import countmein.routes.mergepatch as mp
from countmein.contracts import models_gen as gen
from countmein.models.organizer import Organizer
from countmein.models.service import Service
from countmein.models.time_slot import TimeSlot


def test_field_tables_pin_the_update_schemas():
    """ADR-024: the merge-patch field table must expose exactly the
    update schema's fields — a wire key the table forgot (or a schema
    field the table missed) makes a patch silently unwritable, and a
    table column that names no model attribute must not exist."""
    cases = [
        (mp.SERVICE_FIELDS, Service, gen.UpdateServiceInput),
        (mp.ORGANIZER_FIELDS, Organizer, gen.UpdateOrganizerProfileInput),
        (mp.SLOT_FIELDS, TimeSlot, gen.UpdateTimeSlotInput),
    ]
    for fields, model_cls, schema in cases:
        assert set(fields) == set(schema.model_fields), (
            f"{schema.__name__} fields {sorted(schema.model_fields)} != "
            f"field table {sorted(fields)}"
        )
        for key, f in fields.items():
            assert f.column in model_cls.__table__.columns, (
                f"{key}: column {f.column} missing on {model_cls.__tablename__}"
            )


def service_state_fixture() -> dict:
    """The merge-patch base for a service, mirroring the field table's
    wire projection (the same field set the DB row renders)."""
    return {
        "title": "Yoga",
        "description": "Morning flow",
        "location": None,
        "contact": None,
        "defaultPrice": "10",
        "defaultCapacity": 8,
        "defaultDurationMinutes": 60,
        "maxSeatsPerBooking": 2,
        "options": ["A", "B"],
        "optionsSelectMode": "single",
        "photoUrl": None,
    }


def test_merge_patch_clears_options_pair():
    """A merge patch that clears the options pair: both keys must be sent
    as null (the pair rule), and the merged state must carry neither —
    which is what makes the merged-state refinement pass and the DB
    write NULL into both columns."""
    merged = mp.merge_patch(service_state_fixture(), b'{"options":null,"optionsSelectMode":null}')
    state = json.loads(merged)
    # RFC 7386 removes null keys outright, so "cleared" is
    # absent-or-None here.
    assert not state.get("options")
    assert not state.get("optionsSelectMode")
    # Untouched fields survive the merge.
    assert state["title"] == "Yoga"
    assert state["defaultCapacity"] == 8


def test_merge_patch_keeps_absent_keys():
    """Absent keys keep the current value (the RFC 7386 half that makes
    a partial update possible at all)."""
    merged = mp.merge_patch(service_state_fixture(), b'{"defaultPrice":"20"}')
    state = json.loads(merged)
    assert state["defaultPrice"] == "20"
    assert state["options"] == ["A", "B"]
    assert state["optionsSelectMode"] == "single"


def test_merge_patch_nested_objects():
    """A nested dict merges recursively: patch keys merge into the
    current object, nulls remove a member, untouched keys survive."""
    state = {"a": {"x": 1, "y": 2}, "b": 1}
    merged = mp.merge_patch(state, b'{"a":{"y":3,"z":4},"b":null}')
    out = json.loads(merged)
    assert out == {"a": {"x": 1, "y": 3, "z": 4}}


def test_merge_patch_dict_replaced_by_scalar():
    """RFC 7386: a non-dict patch value replaces the target wholesale,
    even when the target is a dict."""
    merged = mp.merge_patch({"a": {"x": 1}}, b'{"a":"flat"}')
    assert json.loads(merged) == {"a": "flat"}


def test_merge_patch_scalar_replaced_by_dict():
    """The mirror: a dict patch over a scalar key yields the dict —
    the target contributes nothing."""
    merged = mp.merge_patch({"a": 1}, b'{"a":{"x":1}}')
    assert json.loads(merged) == {"a": {"x": 1}}


def test_patch_keys():
    """patch_keys is the touched-set the DB layer writes columns from:
    an empty object and a non-object are "nothing to update" (400), a
    real patch names exactly the keys the client sent."""
    for name, body in {
        "empty": b"{}",
        "null": b"null",
        "not json": b"not json",
        "array": b"[]",
        "no keys": b'{"":1}',  # still one key: the caller maps it to no columns
    }.items():
        got = mp.patch_keys(body)
        assert (got is not None) == (name == "no keys"), name

    keys = mp.patch_keys(b'{"title":"Yoga","options":null}')
    assert keys == {"title", "options"}


def test_merge_patch_preserves_null_options():
    """Service rows carry options as NULL or an array; the merge base
    must round-trip both shapes without inventing an empty array."""
    state = service_state_fixture()
    state["options"] = None
    state["optionsSelectMode"] = None

    merged = mp.merge_patch(state, b'{"defaultPrice":"20"}')
    out = json.loads(merged)
    assert "options" not in out or out["options"] is None


def test_merge_patch_slot_starts_at():
    """The slot merge base renders startsAt as an ISO string; a patch
    may replace it (string or epoch) but the untouched value must
    survive."""
    row = TimeSlot(
        id="01930000-0000-7000-8000-000000000001",
        service_id="svc-abcdefghij123456",
        starts_at=datetime(2026, 1, 1, 9, 0, tzinfo=UTC),
        duration_minutes=60,
        capacity=10,
        booked_count=0,
        price="10",
        created_at=None,
    )
    base = {key: f.to_wire(getattr(row, f.column)) for key, f in mp.SLOT_FIELDS.items()}
    merged = mp.merge_patch(base, b'{"capacity":12}')
    out = json.loads(merged)
    assert "startsAt" in out, "startsAt must survive an unrelated patch"
    assert out["capacity"] == 12
