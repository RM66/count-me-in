"""The RFC 7386 merge and the
touched-key set the DB layer writes columns from."""

import json

import countmein.routes.mergepatch as mp
from countmein.db.rows import TimeSlotRow
from countmein.routes.slots import slot_writable_state


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
    # RFC 7386 removes null keys outright — Go's unmarshal reads the
    # absent key as a nil pointer, so "cleared" is absent-or-None here.
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
