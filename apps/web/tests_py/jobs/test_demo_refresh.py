"""The demo.refresh handler and the guest-list expiry invariant.

demo.refresh reseeds the demo organizer on a QStash cron (ADR-010) —
the handler is a thin wrapper around seed_demo, so the test pins the
wiring (seed called with a UTC now) without touching the database.

The expiry invariant (AGENTS.md): an expired manage token must keep the
booking listed with canCancel=false — the guest list never drops rows,
the dead link is just not offered. Pinned at the row level, where the
rule lives."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import countmein.jobs.demo_refresh as refresh_mod
from countmein.db.rows import (
    BookingRow,
    OrganizerRow,
    ServiceRow,
    TimeSlotRow,
    can_cancel_booking,
    to_guest_booking,
)


async def test_demo_refresh_calls_seed_demo_with_now(monkeypatch):
    calls: list[datetime] = []

    async def fake_seed(now):
        calls.append(now)

    monkeypatch.setattr(refresh_mod, "seed_demo", fake_seed)
    await refresh_mod.handle_demo_refresh()
    assert len(calls) == 1
    # The seed time is a timezone-aware UTC instant (the slot times are
    # stored relative to it).
    assert calls[0].tzinfo is not None
    assert abs((datetime.now(UTC) - calls[0]).total_seconds()) < 60


def _booking(expires_at: datetime | None, status: str = "confirmed") -> BookingRow:
    return BookingRow(
        id="b1",
        time_slot_id="s1",
        status=status,
        seats=1,
        guest_name="Guest",
        guest_messenger="telegram",
        guest_messenger_id="1",
        guest_locale="en",
        manage_token="tok",
        manage_token_hash="hash",
        created_at=datetime(2026, 9, 20, 12, 0, tzinfo=UTC),
        manage_token_expires_at=expires_at,
    )


def _slot() -> TimeSlotRow:
    return TimeSlotRow(
        id="s1",
        service_id="sv1",
        starts_at=datetime(2026, 9, 27, 10, 0, tzinfo=UTC),
        duration_minutes=60,
        capacity=10,
        booked_count=1,
        created_at=datetime(2026, 9, 20, 12, 0, tzinfo=UTC),
    )


def _service() -> ServiceRow:
    return ServiceRow(
        id="sv1",
        organizer_id="o1",
        title="Yoga",
        default_price="10",
        default_capacity=10,
        default_duration_minutes=60,
        max_seats_per_booking=5,
        created_at=datetime(2026, 9, 20, 12, 0, tzinfo=UTC),
    )


def _organizer() -> OrganizerRow:
    return OrganizerRow(
        id="o1",
        slug="org",
        name="Org",
        messenger="telegram",
        messenger_id="1",
        timezone="Europe/Belgrade",
        language="en",
        created_at=datetime(2026, 9, 20, 12, 0, tzinfo=UTC),
    )


def test_expired_booking_stays_listed_with_can_cancel_false():
    """The invariant: an expired token keeps the row in the guest list
    (canCancel=false), a live token offers the link, and a legacy row
    without expiry stays cancellable (ADR-020 backfill semantics)."""
    now = datetime(2026, 9, 27, 12, 0, tzinfo=UTC)
    expired = _booking(now - timedelta(hours=1))
    live = _booking(now + timedelta(hours=1))
    legacy = _booking(None)
    cancelled = _booking(now + timedelta(hours=1), status="cancelled")

    assert can_cancel_booking(expired, now) is False
    assert can_cancel_booking(live, now) is True
    assert can_cancel_booking(legacy, now) is True
    assert can_cancel_booking(cancelled, now) is False

    # The DTO keeps the row listed with the dead link not offered.
    dto = to_guest_booking(expired, _slot(), _service(), _organizer())
    assert dto.status == "confirmed"
    assert dto.canCancel is False
    assert dto.manageToken == "tok"  # the row is not dropped or masked
