"""Booking route tests — through the FastAPI app (the handlers' preamble
is a set of dependencies, so the app is the only faithful way to invoke
them; direct calls would bypass the rate limiter and ticket order).

Redis-backed state (rate buckets, tickets) runs against fakeredis.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time

import httpx
import pytest
from countmein import redis as redis_mod
from countmein.auth.session import ORGANIZER_AUTH_HEADER
from countmein.auth.telegram import TICKET_PURPOSE_GUEST
from countmein.auth.ticket import issue_ticket
from countmein.contracts.constants_gen import DEMO_ORGANIZER_ID, DEMO_READ_ONLY_CODE
from countmein.contracts.payloads import AuthTicketPayload
from countmein.models.outbox import OutboxMessage

TEST_SECRET = "guards-test-golden-secret"
BASE = "http://testserver"

# A schema-valid booking body: everything the spec requires, with the
# ticket swapped per test.
VALID_BOOKING_BODY = (
    '{"serviceId":"svc-abcdefghij123456",'
    '"timeSlotId":"01930000-0000-7000-8000-000000000001",'
    '"seats":1,"guestName":"Ann","guestTicket":"%s"}'
)


@pytest.fixture()
async def fake_redis(monkeypatch):
    import fakeredis.aioredis

    fake = fakeredis.aioredis.FakeRedis()
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(redis_mod, "client", lambda: fake)
    yield fake
    await fake.aclose()


@pytest.fixture(autouse=True)
def _trust_proxy(monkeypatch):
    # Rate buckets key on distinct X-Forwarded-For IPs; outside Vercel
    # that header is only honored with the explicit opt-in.
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    monkeypatch.setenv("AUTH_SECRET", TEST_SECRET)


@pytest.fixture()
async def app(fake_redis):
    from countmein.app import create_app

    yield create_app()


@pytest.fixture()
async def client(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url=BASE, timeout=30.0) as c:
        yield c


def mint_test_token(secret: str, sub: str, slug: str, exp: int) -> str:
    """The shared organizer-auth mint (the derivation itself is pinned
    by the golden test in tests_py/auth/test_session.py)."""
    import base64

    from countmein.auth.session import derived_signing_key

    header = (
        base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
        .rstrip(b"=")
        .decode()
    )
    payload = (
        base64.urlsafe_b64encode(
            json.dumps(
                {
                    "iss": "countmein-web",
                    "aud": "countmein-api",
                    "sub": sub,
                    "slug": slug,
                    "iat": int(time.time()),
                    "exp": exp,
                }
            ).encode()
        )
        .rstrip(b"=")
        .decode()
    )
    signing_input = f"{header}.{payload}"
    sig = hmac.new(derived_signing_key(secret), signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{base64.urlsafe_b64encode(sig).rstrip(b'=').decode()}"


def decode_body_error(response: httpx.Response) -> dict:
    body = response.content.decode() if response.content else ""
    return json.loads(body) if body else {}


# ── BookingCreate ────────────────────────────────────────────────────────────


async def test_booking_create_rate_limit(client):
    # 5/min per IP: five requests burn the bucket (each fails body
    # validation — 400, but AFTER the limiter), the sixth is a 429.
    for i in range(5):
        r = await client.post(
            "/api/bookings", content=b"", headers={"x-forwarded-for": "198.51.100.1"}
        )
        assert r.status_code == 400, f"request {i + 1}"
    r = await client.post("/api/bookings", content=b"", headers={"x-forwarded-for": "198.51.100.1"})
    assert r.status_code == 429
    assert "retry-after" in {k.lower() for k in r.headers.keys()}


async def test_booking_create_invalid_body(client):
    r = await client.post(
        "/api/bookings", content=b'{"guestName":', headers={"x-forwarded-for": "198.51.100.2"}
    )
    assert r.status_code == 400
    body = decode_body_error(r)
    assert body.get("error"), "400 must carry localized error copy"


async def test_booking_create_unknown_ticket(client):
    # Unknown ticket, nonexistent slot: the domain refusal runs before
    # redemption (ADR-024 B1) — the answer is the slot's 404, the ticket
    # is not consulted.
    body = (VALID_BOOKING_BODY % "unknown-ticket-aaaaaaaaaaaaaaaaaaaaaaaaa").encode()
    r = await client.post(
        "/api/bookings", content=body, headers={"x-forwarded-for": "198.51.100.3"}
    )
    assert r.status_code == 404


async def test_booking_create_raw_messenger_id_ignored(client):
    # Invariant 8: identity comes only from the ticket. A body claiming
    # a messengerId must not authenticate — the domain refusal answers
    # before the ticket is even looked at.
    body = (VALID_BOOKING_BODY % "unknown-ticket-bbbbbbbbbbbbbbbbbbbbbbbbb").encode()
    body = body[:-1] + b',"messengerId":"999999"}'
    r = await client.post(
        "/api/bookings", content=body, headers={"x-forwarded-for": "198.51.100.4"}
    )
    assert r.status_code == 404


async def test_validation_error_does_not_consume_guest_ticket(client, fake_redis):
    """Order pin: decode runs BEFORE the ticket stage — a body failing
    validation must leave the ticket redeemable. With ADR-024 B1 the same
    holds one stage further: a domain refusal (a nonexistent slot)
    leaves it intact too."""
    ticket = await issue_ticket(
        AuthTicketPayload(
            messenger="telegram",
            messenger_id="123456789",
            display_name="Ann",
            messenger_login=None,
            purpose=TICKET_PURPOSE_GUEST,
        )
    )
    # Invalid body carrying a valid ticket: 400, ticket still there.
    bad = b'{"serviceId": "x", "guestTicket": "' + ticket.encode() + b'"}'
    r = await client.post("/api/bookings", content=bad, headers={"x-forwarded-for": "198.51.100.9"})
    assert r.status_code == 400
    assert await fake_redis.exists(f"auth:ticket:{ticket}") == 1, (
        "a validation error must not consume the guest ticket"
    )
    # Valid body, same ticket, nonexistent slot: the domain refusal
    # (404 SlotGone) runs before redemption — the ticket survives.
    body = (VALID_BOOKING_BODY % ticket).encode()
    r = await client.post(
        "/api/bookings", content=body, headers={"x-forwarded-for": "198.51.100.9"}
    )
    assert r.status_code == 404, "a nonexistent slot answers SlotGone"
    assert await fake_redis.exists(f"auth:ticket:{ticket}") == 1, (
        "a domain refusal must not consume the guest ticket (ADR-024 B1)"
    )


# ── BookingLookup ────────────────────────────────────────────────────────────


async def test_booking_lookup_invalid_body(client):
    r = await client.post(
        "/api/bookings/lookup", content=b"{", headers={"x-forwarded-for": "198.51.100.5"}
    )
    assert r.status_code == 400


async def test_booking_lookup_unknown_ticket(client):
    r = await client.post(
        "/api/bookings/lookup",
        content=b'{"guestTicket":"unknown-ticket-ccccccccccccccccccccccc"}',
        headers={"x-forwarded-for": "198.51.100.6"},
    )
    assert r.status_code == 401


# ── BookingCancel ────────────────────────────────────────────────────────────


async def test_booking_cancel_rate_limit(client):
    # 10/min per IP — manageToken is brute-forceable, so cancel is
    # throttled like booking creation.
    for i in range(10):
        r = await client.post(
            "/api/bookings/cancel", content=b"", headers={"x-forwarded-for": "198.51.100.7"}
        )
        assert r.status_code == 400, f"request {i + 1}"
    r = await client.post(
        "/api/bookings/cancel", content=b"", headers={"x-forwarded-for": "198.51.100.7"}
    )
    assert r.status_code == 429


async def test_booking_cancel_invalid_body(client):
    r = await client.post(
        "/api/bookings/cancel",
        content=b'{"manageToken":',
        headers={"x-forwarded-for": "198.51.100.8"},
    )
    assert r.status_code == 400


# ── BookingCancelByOrganizer ─────────────────────────────────────────────────


def organizer_headers(organizer_id: str) -> dict[str, str]:
    if not organizer_id:
        return {}
    token = mint_test_token(TEST_SECRET, organizer_id, "studio", int(time.time()) + 60)
    return {ORGANIZER_AUTH_HEADER: token}


async def test_booking_cancel_by_organizer_anonymous(client):
    # /cabinet needs no session (ADR-010) — an anonymous visitor is a
    # demo-cabinet visitor and must not cancel anyone's booking.
    r = await client.post(
        "/api/bookings/cancel-by-organizer",
        content=b'{"bookingId":"01930000-0000-7000-8000-000000000001"}',
    )
    assert r.status_code == 403
    body = decode_body_error(r)
    assert body.get("code") == DEMO_READ_ONLY_CODE


async def test_booking_cancel_by_organizer_demo_session(client):
    r = await client.post(
        "/api/bookings/cancel-by-organizer",
        content=b'{"bookingId":"01930000-0000-7000-8000-000000000001"}',
        headers=organizer_headers(DEMO_ORGANIZER_ID),
    )
    assert r.status_code == 403


async def test_booking_cancel_by_organizer_invalid_body(client):
    # A signed-in organizer passes the guard then fails body validation
    # — the guard and the decode are separate doors.
    r = await client.post(
        "/api/bookings/cancel-by-organizer",
        content=b'{"bookingId":',
        headers=organizer_headers("01930000-0000-7000-8000-0000000000c1"),
    )
    assert r.status_code == 400


# ── publish_outbox_rows ──────────────────────────────────────────────────────


async def test_publish_outbox_rows_absorbs_publish_errors(monkeypatch):
    """The publisher absorbs its own errors (ADR-012): the booking is
    already committed — the row stays `pending` and the sweeper retries
    it."""
    from countmein.routes import bookings as bookings_route

    monkeypatch.setenv("QSTASH_TOKEN", "test-token")
    monkeypatch.setenv("QSTASH_URL", "http://127.0.0.1:1")  # unreachable — fails fast
    monkeypatch.setenv("APP_URL", "https://example.com")

    rows = [
        OutboxMessage(
            id="01930000-0000-7000-8000-0000000000d1",
            queue="booking.created",
            payload='{"bookingId":"x","recipient":"organizer"}',
            trace_id="",
            status="pending",
            attempts=0,
        ),
        OutboxMessage(
            id="01930000-0000-7000-8000-0000000000d2",
            queue="booking.created",
            payload='{"bookingId":"x","recipient":"guest"}',
            trace_id="",
            status="pending",
            attempts=0,
        ),
    ]
    # Must not raise and must not propagate the publish error.
    await bookings_route.publish_outbox_rows(rows, "trace-absorb")


# ── Booking routes against a real Postgres ───────────────────────────────────


def require_postgres():
    from _env import require_postgres as _require

    return _require()


async def guest_ticket(messenger_id: str) -> str:
    return await issue_ticket(
        AuthTicketPayload(
            messenger="telegram",
            messenger_id=messenger_id,
            display_name="Ann",
            photo_url=None,
            messenger_login=None,
            purpose=TICKET_PURPOSE_GUEST,
        )
    )


class RouteFixture:
    def __init__(self, organizer_id: str, service_id: str, slot_id: str):
        self.organizer_id = organizer_id
        self.service_id = service_id
        self.slot_id = slot_id
        self.booking_ids: list[str] = []


async def new_route_fixture(capacity: int, booked: int) -> RouteFixture:
    import secrets
    import uuid

    from countmein.db.client import engine
    from sqlalchemy import text

    require_postgres()
    org_id = str(uuid.uuid4())
    service_id = "rtest-" + secrets.token_hex(8)
    slot_id = str(uuid.uuid4())
    fixture = RouteFixture(org_id, service_id, slot_id)
    suffix = org_id[-12:]
    async with engine().begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO organizers (id, slug, name, messenger, messenger_id, timezone, language) "
                "VALUES (:id, :slug, 'Route Test Organizer', 'telegram', :mid, 'Europe/Belgrade', 'en')"
            ),
            {"id": org_id, "slug": "rt-org-" + suffix, "mid": "rt-" + suffix},
        )
        await conn.execute(
            text(
                "INSERT INTO services (id, organizer_id, title, default_price, default_capacity, "
                "default_duration_minutes, max_seats_per_booking) "
                "VALUES (:id, :org_id, 'Route Test Service', '10 EUR', 10, 60, 4)"
            ),
            {"id": service_id, "org_id": org_id},
        )
        await conn.execute(
            text(
                "INSERT INTO time_slots (id, service_id, starts_at, duration_minutes, capacity, booked_count) "
                "VALUES (:id, :sid, now() + interval '48 hours', 60, :capacity, :booked)"
            ),
            {"id": slot_id, "sid": service_id, "capacity": capacity, "booked": booked},
        )
    return fixture


async def _cleanup_route_fixture(fixture: RouteFixture) -> None:
    """Booking rows first, then the organizer (its delete cascades
    services + slots)."""
    from countmein.db.client import engine
    from sqlalchemy import text

    async with engine().begin() as conn:
        if fixture.booking_ids:
            await conn.execute(
                text(
                    "DELETE FROM notification_outbox "
                    "WHERE (payload::jsonb->>'bookingId')::text = ANY(:ids)"
                ),
                {"ids": fixture.booking_ids},
            )
            await conn.execute(
                text("DELETE FROM bookings WHERE id::text = ANY(:ids)"),
                {"ids": fixture.booking_ids},
            )
        await conn.execute(
            text("DELETE FROM organizers WHERE id = :id"), {"id": fixture.organizer_id}
        )


async def test_booking_create_happy_path(client, monkeypatch):
    fixture = await new_route_fixture(10, 0)
    try:
        await _happy_path(fixture, monkeypatch, client)
    finally:
        await _cleanup_route_fixture(fixture)


async def _happy_path(fixture, monkeypatch, client):
    monkeypatch.setenv("QSTASH_TOKEN", "test-token")
    monkeypatch.setenv("QSTASH_URL", "http://127.0.0.1:1")  # unreachable — rows stay pending
    monkeypatch.setenv("APP_URL", "https://example.com")

    body = json.dumps(
        {
            "serviceId": fixture.service_id,
            "timeSlotId": fixture.slot_id,
            "seats": 2,
            "guestName": "Ann",
            "guestTicket": await guest_ticket("rt-happy-1"),
        }
    ).encode()
    r = await client.post(
        "/api/bookings", content=body, headers={"x-forwarded-for": "203.0.113.21"}
    )

    assert r.status_code == 201, r.text
    envelope = json.loads(r.content)
    booking = envelope["booking"]
    assert booking["manageToken"], "the guest DTO must carry the manageToken"
    booking_id = booking["id"]
    fixture.booking_ids.append(booking_id)

    # Seats claimed…
    from countmein.db.client import engine
    from sqlalchemy import text

    async with engine().connect() as conn:
        booked = (
            await conn.execute(
                text("SELECT booked_count FROM time_slots WHERE id = :id"),
                {"id": fixture.slot_id},
            )
        ).scalar_one()
    assert booked == 2
    # …and the fan-out rows are durable + pending (publish failed, so
    # the sweeper must still see them).
    async with engine().connect() as conn:
        pending = (
            await conn.execute(
                text(
                    "SELECT count(*) FROM notification_outbox "
                    "WHERE (payload::jsonb->>'bookingId') = :id AND status = 'pending'"
                ),
                {"id": booking_id},
            )
        ).scalar_one()
    assert pending == 2, "want 2 pending outbox rows (organizer + guest)"


async def test_booking_create_sold_out_maps_409(client, monkeypatch):
    fixture = await new_route_fixture(2, 2)  # full slot
    try:
        await _sold_out(fixture, monkeypatch, client)
    finally:
        await _cleanup_route_fixture(fixture)


async def _sold_out(fixture, monkeypatch, client):
    monkeypatch.setenv("QSTASH_TOKEN", "test-token")
    monkeypatch.setenv("QSTASH_URL", "http://127.0.0.1:1")
    monkeypatch.setenv("APP_URL", "https://example.com")

    body = json.dumps(
        {
            "serviceId": fixture.service_id,
            "timeSlotId": fixture.slot_id,
            "seats": 1,
            "guestName": "Ann",
            "guestTicket": await guest_ticket("rt-soldout-1"),
        }
    ).encode()
    r = await client.post(
        "/api/bookings", content=body, headers={"x-forwarded-for": "203.0.113.22"}
    )

    assert r.status_code == 409, r.text
    # The dialog renders "how many are left" from the extras — the
    # wiring must carry seatsLeft through.
    b = json.loads(r.content)
    assert b.get("seatsLeft") == 0
    assert b.get("error"), "409 must carry localized error copy"


async def test_booking_create_sold_out_leaves_ticket(client, fake_redis, monkeypatch):
    """ADR-024 B1: a domain refusal must not burn the ticket — after a
    409 it stays redeemable (the guest retries without re-running the
    widget)."""
    fixture = await new_route_fixture(2, 2)  # full slot
    try:
        monkeypatch.setenv("QSTASH_TOKEN", "test-token")
        monkeypatch.setenv("APP_URL", "https://example.com")

        ticket = await guest_ticket("rt-soldout-reuse")
        body = json.dumps(
            {
                "serviceId": fixture.service_id,
                "timeSlotId": fixture.slot_id,
                "seats": 1,
                "guestName": "Ann",
                "guestTicket": ticket,
            }
        ).encode()
        r = await client.post(
            "/api/bookings", content=body, headers={"x-forwarded-for": "203.0.113.23"}
        )
        assert r.status_code == 409, r.text
        assert await fake_redis.exists(f"auth:ticket:{ticket}") == 1, (
            "SoldOut must leave the guest ticket consumable"
        )
    finally:
        await _cleanup_route_fixture(fixture)


async def test_booking_create_bad_ticket_on_real_slot(client, fake_redis, monkeypatch):
    """A forged ticket on a bookable slot: the seat is claimed and
    released by the rollback — 401, booked_count unchanged."""
    fixture = await new_route_fixture(10, 0)
    try:
        monkeypatch.setenv("QSTASH_TOKEN", "test-token")
        monkeypatch.setenv("APP_URL", "https://example.com")

        body = json.dumps(
            {
                "serviceId": fixture.service_id,
                "timeSlotId": fixture.slot_id,
                "seats": 1,
                "guestName": "Ann",
                "guestTicket": "forged-ticket-xxxxxxxxxxxxxxxxxxxxxxxx",
            }
        ).encode()
        r = await client.post(
            "/api/bookings", content=body, headers={"x-forwarded-for": "203.0.113.24"}
        )
        assert r.status_code == 401, r.text

        from countmein.db.client import engine
        from sqlalchemy import text

        async with engine().connect() as conn:
            booked = (
                await conn.execute(
                    text("SELECT booked_count FROM time_slots WHERE id = :id"),
                    {"id": fixture.slot_id},
                )
            ).scalar_one()
        assert booked == 0, "the rolled-back claim must not leak a seat"
    finally:
        await _cleanup_route_fixture(fixture)


async def test_booking_cancel_unknown_token_is_404(client):
    fixture = await new_route_fixture(10, 0)  # schema must exist; token matches nothing
    try:
        r = await client.post(
            "/api/bookings/cancel",
            content=b'{"manageToken":"' + b"a" * 43 + b'"}',
            headers={"x-forwarded-for": "203.0.113.23"},
        )
        assert r.status_code == 404, r.text
    finally:
        await _cleanup_route_fixture(fixture)


# ── GET /api/bookings — server-side filters ──────────────────────────────────
#
# The cabinet's URL state maps onto the query params: a page of 50 rows is
# already the filtered view, and `bookedDays` marks the scoped calendar days
# (in the organizer's timezone) for the day picker.


def _org_headers(fixture) -> dict:
    return {
        ORGANIZER_AUTH_HEADER: mint_test_token(
            TEST_SECRET, fixture.organizer_id, "rt", int(time.time()) + 3600
        )
    }


async def _seed_bookings(fixture, rows) -> list[str]:
    """Insert booking rows directly — the list endpoint is a read, so the
    guest-ticket flow would be unnecessary ceremony."""
    import secrets
    import uuid

    from countmein.db.client import engine
    from sqlalchemy import text

    ids = []
    async with engine().begin() as conn:
        for i, row in enumerate(rows):
            booking_id = str(uuid.uuid4())
            token = secrets.token_hex(32)
            await conn.execute(
                text(
                    "INSERT INTO bookings (id, time_slot_id, status, seats, guest_name, "
                    "guest_messenger, guest_messenger_id, guest_messenger_login, "
                    "manage_token, manage_token_hash, created_at) "
                    "VALUES (:id, :slot, :status, :seats, :name, 'telegram', :mid, :login, "
                    ":token, :hash, COALESCE(CAST(:created_at AS timestamptz), now()))"
                ),
                {
                    "id": booking_id,
                    "slot": row.get("slot_id", fixture.slot_id),
                    "status": row.get("status", "confirmed"),
                    "seats": row.get("seats", 1),
                    "name": row["name"],
                    # ISO instant — rows seeded in one transaction share
                    # created_at otherwise, and ordering tests need a
                    # deterministic "newest first".
                    "created_at": row.get("created_at"),
                    # Distinct per row: the one-active-per-guest-per-slot index
                    # would otherwise reject a second confirmed booking.
                    "mid": row.get("mid", f"rt-mid-{i}"),
                    "login": row.get("login"),
                    "token": token,
                    # Opaque to these tests — only uniqueness matters.
                    "hash": token,
                },
            )
            ids.append(booking_id)
    fixture.booking_ids.extend(ids)
    return ids


async def _seed_service_and_slot(fixture) -> tuple[str, str]:
    """A second service + slot for the fixture organizer — scope filters
    need more than one of each to be meaningful."""
    import secrets
    import uuid

    from countmein.db.client import engine
    from sqlalchemy import text

    service_id = "rtest-" + secrets.token_hex(8)
    slot_id = str(uuid.uuid4())
    async with engine().begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO services (id, organizer_id, title, default_price, "
                "default_capacity, default_duration_minutes, max_seats_per_booking) "
                "VALUES (:id, :org_id, 'Route Pottery', '20 EUR', 8, 90, 1)"
            ),
            {"id": service_id, "org_id": fixture.organizer_id},
        )
        await conn.execute(
            text(
                "INSERT INTO time_slots (id, service_id, starts_at, duration_minutes, "
                "capacity, booked_count) "
                "VALUES (:id, :sid, now() + interval '72 hours', 90, 8, 0)"
            ),
            {"id": slot_id, "sid": service_id},
        )
    return service_id, slot_id


def _fixture_slot_day() -> str:
    """The fixture slot starts now()+48h — its calendar day *in the
    organizer's timezone* (Europe/Belgrade), not UTC."""
    from datetime import UTC, datetime, timedelta
    from zoneinfo import ZoneInfo

    return (
        (datetime.now(UTC) + timedelta(hours=48))
        .astimezone(ZoneInfo("Europe/Belgrade"))
        .strftime("%Y-%m-%d")
    )


async def test_bookings_list_returns_scoped_day_marks(client):
    fixture = await new_route_fixture(10, 0)
    try:
        await _seed_bookings(fixture, [{"name": "Ann Smith"}])
        day = _fixture_slot_day()

        # The marks are opt-in — a bare page does not pay the DISTINCT scan.
        r = await client.get("/api/bookings", headers=_org_headers(fixture))
        assert r.status_code == 200, r.text
        envelope = r.json()
        assert [b["guestName"] for b in envelope["bookings"]] == ["Ann Smith"]
        assert envelope["bookedDays"] is None

        r = await client.get("/api/bookings?include=days", headers=_org_headers(fixture))
        assert r.json()["bookedDays"] == [day]
    finally:
        await _cleanup_route_fixture(fixture)


async def test_bookings_list_status_filter_keeps_the_marks(client):
    fixture = await new_route_fixture(10, 0)
    try:
        await _seed_bookings(
            fixture,
            [
                {"name": "Ann Smith", "status": "confirmed"},
                {"name": "Bob Jones", "status": "cancelled"},
            ],
        )
        headers = _org_headers(fixture)

        r = await client.get("/api/bookings?status=confirmed&include=days", headers=headers)
        assert [b["guestName"] for b in r.json()["bookings"]] == ["Ann Smith"]
        # Marks answer "when is anything booked" — the status filter does
        # not narrow them.
        assert r.json()["bookedDays"] == [_fixture_slot_day()]

        r = await client.get("/api/bookings?status=cancelled", headers=headers)
        assert [b["guestName"] for b in r.json()["bookings"]] == ["Bob Jones"]
    finally:
        await _cleanup_route_fixture(fixture)


async def test_bookings_list_scopes_by_slot_and_service(client):
    fixture = await new_route_fixture(10, 0)
    try:
        service2, slot2 = await _seed_service_and_slot(fixture)
        await _seed_bookings(
            fixture,
            [
                {"name": "Ann Smith"},
                {"name": "Bob Jones", "slot_id": slot2},
            ],
        )
        headers = _org_headers(fixture)

        r = await client.get(f"/api/bookings?slotId={fixture.slot_id}", headers=headers)
        assert [b["guestName"] for b in r.json()["bookings"]] == ["Ann Smith"]

        # The service scope follows the transitive join — there is no
        # Booking.serviceId.
        r = await client.get(f"/api/bookings?serviceId={service2}", headers=headers)
        assert [b["guestName"] for b in r.json()["bookings"]] == ["Bob Jones"]

        # A foreign slot scopes to an empty page, not a leak.
        import uuid

        r = await client.get(f"/api/bookings?slotId={uuid.uuid4()}", headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["bookings"] == []
    finally:
        await _cleanup_route_fixture(fixture)


async def test_bookings_list_search_matches_guest_and_service(client):
    fixture = await new_route_fixture(10, 0)
    try:
        await _seed_bookings(
            fixture,
            [
                {"name": "Ann Smith", "login": "annsmith"},
                {"name": "Bob Jones", "login": "bobbyj"},
            ],
        )
        headers = _org_headers(fixture)

        # Guest name and messenger login, both case-insensitive.
        r = await client.get("/api/bookings", params={"q": "smith"}, headers=headers)
        assert [b["guestName"] for b in r.json()["bookings"]] == ["Ann Smith"]
        r = await client.get("/api/bookings", params={"q": "BOBBYJ"}, headers=headers)
        assert [b["guestName"] for b in r.json()["bookings"]] == ["Bob Jones"]

        # The service title matches too — the fixture service is
        # 'Route Test Service'.
        r = await client.get("/api/bookings", params={"q": "route test"}, headers=headers)
        assert len(r.json()["bookings"]) == 2

        # Wildcard characters are literal — '%' must not widen the match.
        r = await client.get("/api/bookings", params={"q": "%"}, headers=headers)
        assert r.json()["bookings"] == []
    finally:
        await _cleanup_route_fixture(fixture)


async def test_bookings_list_day_filter_uses_organizer_timezone(client):
    fixture = await new_route_fixture(10, 0)
    try:
        await _seed_bookings(fixture, [{"name": "Ann Smith"}])
        headers = _org_headers(fixture)
        day = _fixture_slot_day()

        r = await client.get("/api/bookings", params={"day": day}, headers=headers)
        assert [b["guestName"] for b in r.json()["bookings"]] == ["Ann Smith"]

        r = await client.get("/api/bookings", params={"day": "1999-01-01"}, headers=headers)
        assert r.json()["bookings"] == []
    finally:
        await _cleanup_route_fixture(fixture)


async def test_bookings_list_sorts_server_side(client):
    fixture = await new_route_fixture(10, 0)
    try:
        await _seed_bookings(
            fixture,
            [
                {"name": "Charlie", "seats": 3, "created_at": "2026-07-01T10:00:00Z"},
                {"name": "ann", "seats": 1, "created_at": "2026-07-02T10:00:00Z"},
                {"name": "Bob", "seats": 2, "created_at": "2026-07-03T10:00:00Z"},
            ],
        )
        headers = _org_headers(fixture)

        r = await client.get("/api/bookings?sort=seats&dir=desc", headers=headers)
        assert [b["seats"] for b in r.json()["bookings"]] == [3, 2, 1]

        # Guest names sort case-insensitively, like the old client sort.
        r = await client.get("/api/bookings?sort=guest&dir=asc", headers=headers)
        assert [b["guestName"] for b in r.json()["bookings"]] == ["ann", "Bob", "Charlie"]

        # No sort → the default newest-first order.
        r = await client.get("/api/bookings", headers=headers)
        assert [b["guestName"] for b in r.json()["bookings"]] == ["Bob", "ann", "Charlie"]
    finally:
        await _cleanup_route_fixture(fixture)


async def test_bookings_list_rejects_malformed_params(client):
    fixture = await new_route_fixture(10, 0)
    try:
        headers = _org_headers(fixture)
        for qs in (
            "status=unknown",
            "sort=evil",
            "dir=sideways",
            "day=2026-13-40",
            "day=2026-02-30",  # real format, impossible date — the route's 400
            "slotId=not-a-uuid",
            "serviceId=bad",
            "limit=0",
        ):
            r = await client.get(f"/api/bookings?{qs}", headers=headers)
            assert r.status_code == 400, f"{qs} answered {r.status_code}"
    finally:
        await _cleanup_route_fixture(fixture)


async def test_bookings_list_carries_referenced_slots(client):
    """The envelope embeds the page's sessions — row labels must not
    require a second whole-schedule fetch (the filter session rides
    along too, so the chip can name it)."""
    fixture = await new_route_fixture(10, 0)
    try:
        _service2, slot2 = await _seed_service_and_slot(fixture)
        await _seed_bookings(
            fixture,
            [{"name": "Ann Smith"}, {"name": "Bob Jones", "slot_id": slot2}],
        )
        headers = _org_headers(fixture)

        r = await client.get("/api/bookings", headers=headers)
        assert {s["id"] for s in r.json()["slots"]} == {fixture.slot_id, slot2}

        # Scoped to one session: only that session travels back.
        r = await client.get(f"/api/bookings?slotId={fixture.slot_id}", headers=headers)
        assert [s["id"] for s in r.json()["slots"]] == [fixture.slot_id]

        # An owned but unbooked filter session is still named; a foreign
        # one resolves to nothing — never a leak.
        import uuid

        _service3, slot3 = await _seed_service_and_slot(fixture)
        r = await client.get(f"/api/bookings?slotId={slot3}", headers=headers)
        assert r.json()["bookings"] == []
        assert [s["id"] for s in r.json()["slots"]] == [slot3]

        r = await client.get(f"/api/bookings?slotId={uuid.uuid4()}", headers=headers)
        assert r.json()["slots"] == []
    finally:
        await _cleanup_route_fixture(fixture)
