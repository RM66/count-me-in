"""Isolated unit tests for the demo guard (ADR-010).

The guard is the security seam every write path leans on, but until now
it was only covered indirectly — via parity scenarios and the HTTP route
integration tests. These tests pin the semantics with no database and
no app: UUID normalization (a raw UUID object slipping past the row
mappers must not silently disable the read-only guard) and empty-id
handling (the anonymous demo-cabinet visitor).
"""

from __future__ import annotations

from uuid import UUID

import pytest
from countmein.contracts.constants_gen import DEMO_ORGANIZER_ID
from countmein.demo.guard import (
    is_demo_organizer,
    is_read_only,
    refuse_demo_write,
)
from countmein.errors import DemoReadOnly


def test_is_demo_organizer_string_id():
    assert is_demo_organizer(DEMO_ORGANIZER_ID)


def test_is_demo_organizer_raw_uuid_object():
    # str() normalizes a UUID object that slipped past the row mappers —
    # a raw UUID == str comparison is always False and would silently
    # disable the read-only guard (ADR-010).
    assert is_demo_organizer(UUID(DEMO_ORGANIZER_ID))


def test_is_demo_organizer_unrelated_values():
    assert not is_demo_organizer("")
    assert not is_demo_organizer("01930000-0000-7000-8000-00000000dead")
    # The comparison is exact and case-sensitive — a cased variant of
    # the demo id is not the demo id.
    assert not is_demo_organizer(DEMO_ORGANIZER_ID.upper())
    # A prefix/suffix of the demo id is not the demo id.
    assert not is_demo_organizer(DEMO_ORGANIZER_ID + "0")
    assert not is_demo_organizer("0" + DEMO_ORGANIZER_ID)


def test_is_read_only_empty_and_demo():
    # Anonymous ("") — a demo-cabinet visitor — and the demo account
    # itself are both read-only.
    assert is_read_only("")
    assert is_read_only(DEMO_ORGANIZER_ID)


def test_is_read_only_valid_non_demo_ids():
    assert not is_read_only("01930000-0000-7000-8000-00000000dead")
    assert not is_read_only(UUID("01930000-0000-7000-8000-00000000dead"))


def test_refuse_demo_write_raises_on_demo_and_empty():
    with pytest.raises(DemoReadOnly):
        refuse_demo_write(DEMO_ORGANIZER_ID)
    with pytest.raises(DemoReadOnly):
        refuse_demo_write("")


def test_refuse_demo_write_noop_on_non_demo():
    # Must not raise — the write proceeds.
    refuse_demo_write("01930000-0000-7000-8000-00000000dead")
