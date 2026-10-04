"""Cabinet summary route tests: the aggregated counts + 30-day
analytics envelope against a live Postgres.

Covers the analytics_trend GROUP BY regression: the per-day date_trunc
bucket must be one shared expression in SELECT and GROUP BY (two
identical func.date_trunc() calls compile to separate bind params →
GroupingError → 500). The anonymous demo scope exercises the query with
zero rows; a real booking proves the trend bucket aggregates."""

from __future__ import annotations

import json

import pytest
from countmein.auth.telegram import TICKET_PURPOSE_GUEST
from countmein.auth.ticket import issue_ticket
from countmein.contracts.payloads import AuthTicketPayload

from ._helpers import (
    auth_headers,
    create_service,
    create_slot,
    register_organizer,
)

pytestmark = pytest.mark.usefixtures("_require_postgres")


async def test_cabinet_summary_anonymous_demo_scope(client, fake_redis, db):
    """Anonymous → demo scope (ADR-010): the grouped trend query must run,
    not 500. The demo seed may or may not be present (per-worker xdist
    DBs are seeded, the shared dev DB may not be) — assert the envelope
    shape, not emptiness."""
    r = await client.get("/api/cabinet/summary")
    assert r.status_code == 200, r.text
    envelope = r.json()
    assert isinstance(envelope["serviceCounts"], list)
    analytics = envelope["analytics"]
    for key in (
        "totalBookings",
        "prevTotalBookings",
        "seatsSold",
        "prevSeatsSold",
        "windowBookings",
        "cancelledInWindow",
    ):
        assert isinstance(analytics[key], int)
    assert isinstance(analytics["trend"], list)
    assert isinstance(analytics["byService"], list)


async def test_cabinet_summary_with_booking_trend_bucket(client, fake_redis, db, monkeypatch):
    """A confirmed booking lands in exactly one per-day trend bucket —
    the grouped query aggregates instead of raising GroupingError."""
    monkeypatch.setenv("QSTASH_TOKEN", "test-token")
    monkeypatch.setenv("QSTASH_URL", "http://127.0.0.1:1")  # unreachable — rows stay pending
    monkeypatch.setenv("APP_URL", "https://example.com")

    org = await register_organizer(client, fake_redis, "cab-sum-01")
    headers = {**auth_headers(sub=org["id"], slug=org["slug"])}
    svc = await create_service(client, headers)
    slot = await create_slot(client, headers, svc["id"])

    ticket = await issue_ticket(
        AuthTicketPayload(
            messenger="telegram",
            messenger_id="cab-sum-guest-1",
            display_name="Ann",
            photo_url=None,
            messenger_login=None,
            purpose=TICKET_PURPOSE_GUEST,
        )
    )
    body = json.dumps(
        {
            "serviceId": svc["id"],
            "timeSlotId": slot["id"],
            "seats": 2,
            "guestName": "Ann",
            "guestTicket": ticket,
        }
    ).encode()
    r = await client.post(
        "/api/bookings", content=body, headers={"x-forwarded-for": "203.0.113.41"}
    )
    assert r.status_code == 201, r.text

    r = await client.get("/api/cabinet/summary", headers=headers)
    assert r.status_code == 200, r.text
    envelope = r.json()
    assert [c["serviceId"] for c in envelope["serviceCounts"]] == [svc["id"]]
    assert envelope["serviceCounts"][0]["confirmedBookingsCount"] == 1

    analytics = envelope["analytics"]
    assert analytics["totalBookings"] == 1
    assert analytics["seatsSold"] == 2
    assert analytics["windowBookings"] == 1
    assert len(analytics["trend"]) == 1
    assert analytics["trend"][0]["bookings"] == 1
    assert analytics["trend"][0]["seats"] == 2
    assert analytics["byService"] == [{"service": svc["title"], "bookings": 1}]

    overview = envelope["overview"]
    assert overview["confirmedBookings"] == 1
    assert overview["confirmedLast7Days"] == 1
    # The helper slot (now+48h) is upcoming and inside the next week.
    assert overview["upcomingSlots"] == 1
    assert overview["upcomingSlotsNext7Days"] == 1
    assert overview["upcomingSeatsBooked"] == 2  # the atomic reserve bumped it
    assert overview["upcomingSeatsOffered"] == 3  # the helper slot's capacity


async def test_cabinet_summary_overview_excludes_past_slots(client, fake_redis, db):
    """Upcoming aggregates ignore sessions that already started — the
    overview's numbers describe the schedule ahead, not history."""
    org = await register_organizer(client, fake_redis, "cab-sum-past")
    headers = {**auth_headers(sub=org["id"], slug=org["slug"])}
    svc = await create_service(client, headers)

    # The API refuses a past startsAt, so the history row goes straight in.
    import uuid

    from countmein.db.client import engine
    from sqlalchemy import text

    async with engine().begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO time_slots (id, service_id, starts_at, duration_minutes, "
                "capacity, booked_count) "
                "VALUES (:id, :sid, now() - interval '48 hours', 90, 8, 4)"
            ),
            {"id": str(uuid.uuid4()), "sid": svc["id"]},
        )

    r = await client.get("/api/cabinet/summary", headers=headers)
    assert r.status_code == 200, r.text
    overview = r.json()["overview"]
    assert overview["upcomingSlots"] == 0
    assert overview["upcomingSlotsNext7Days"] == 0
    assert overview["upcomingSeatsBooked"] == 0
    assert overview["upcomingSeatsOffered"] == 0
