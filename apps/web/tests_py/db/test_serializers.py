"""Serializer pins — the row → DTO mapping fields."""

from __future__ import annotations

from datetime import UTC, datetime

from countmein.db.serializers import to_time_slot_record
from countmein.models.time_slot import TimeSlot


def _slot() -> TimeSlot:
    return TimeSlot(
        id="01930000-0000-7000-8000-000000000001",
        service_id="svc-abcdefghij123456",
        starts_at=datetime(2026, 7, 25, 9, tzinfo=UTC),
        duration_minutes=60,
        capacity=10,
        booked_count=3,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


def test_time_slot_record_maps_occupancy_fields():
    record = to_time_slot_record(_slot())
    assert record.capacity == 10
    assert record.bookedCount == 3
