"""The RFC 7386 merge and the touched-key set the DB layer writes
columns from."""

import json

import countmein.routes.mergepatch as mp
from countmein.contracts import models_gen as gen
from countmein.db.rows import TimeSlotRow
from countmein.routes.slots import slot_writable_state


def test_writable_state_pins_the_update_schema():
    """ADR-024: the merge-patch base must expose exactly the update
    schema's fields — a row attribute the wire forgot (or a wire field
    the projection forgot) makes a patch silently unwritable."""
    import dataclasses

    from countmein.db.rows import OrganizerRow, ServiceRow
    from countmein.routes.organizers import organizer_writable_state
    from countmein.routes.services import service_writable_state

    def blank_row(cls):
        # Writable-state projections read plain attributes; a stub with
        # every field set to a sentinel exercises all of them. Datetime
        # columns need a real value (iso_date formats starts_at).
        from datetime import UTC, datetime

        fields = {
            f.name: (datetime(2026, 1, 1, tzinfo=UTC) if "datetime" in str(f.type) else "x")
            for f in dataclasses.fields(cls)
        }
        return cls(**fields)

    cases = [
        (service_writable_state, ServiceRow, gen.UpdateServiceInput),
        (organizer_writable_state, OrganizerRow, gen.UpdateOrganizerProfileInput),
        (slot_writable_state, TimeSlotRow, gen.UpdateTimeSlotInput),
    ]
    for project, row_cls, model in cases:
        state = project(blank_row(row_cls))
        assert set(state) == set(model.model_fields), (
            f"{project.__name__} fields {sorted(state)} != "
            f"{model.__name__} fields {sorted(model.model_fields)}"
        )


def service_state_fixture() -> dict:
    """The merge-patch base for a service, mirroring
    service_writable_state's shape (the same field set the DB row
    renders)."""
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
    assert keys is not None
    assert keys.get("title") and keys.get("options") and len(keys) == 2


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
    from datetime import UTC, datetime

    row = TimeSlotRow(
        id="01930000-0000-7000-8000-000000000001",
        service_id="svc-abcdefghij123456",
        starts_at=datetime(2026, 1, 1, 9, 0, tzinfo=UTC),
        duration_minutes=60,
        capacity=10,
        booked_count=0,
        price="10",
        created_at=None,
    )
    merged = mp.merge_patch(slot_writable_state(row), b'{"capacity":12}')
    out = json.loads(merged)
    assert "startsAt" in out, "startsAt must survive an unrelated patch"
