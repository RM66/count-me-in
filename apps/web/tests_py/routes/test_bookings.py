"""Booking route tests — through the FastAPI app (the handlers'
preamble is a set of dependencies, so the app is the only faithful way
to invoke them; direct calls would bypass the rate limiter and the
ticket consumption order).

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
from countmein.db.rows import OutboxRow

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
    # The booking tests key rate buckets by distinct X-Forwarded-For
    # IPs; outside Vercel that header is only honored with the
    # explicit opt-in.
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
    # 5/min per IP. The first five requests burn the bucket (each fails
    # body validation — 400, but AFTER the limiter), the sixth is a 429.
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
    # Schema-valid body, unknown ticket pointing at a nonexistent slot:
    # the domain refusal runs before redemption (ADR-024 B1), so the
    # answer is the slot's 404 — the ticket is not even consulted.
    body = (VALID_BOOKING_BODY % "unknown-ticket-aaaaaaaaaaaaaaaaaaaaaaaaa").encode()
    r = await client.post(
        "/api/bookings", content=body, headers={"x-forwarded-for": "198.51.100.3"}
    )
    assert r.status_code == 404


async def test_booking_create_raw_messenger_id_ignored(client):
    # Invariant 8: identity comes only from the ticket. A body claiming
    # a messengerId must not authenticate the request — nothing in it
    # is trusted; the domain refusal answers before the ticket would
    # even be looked at.
    body = (VALID_BOOKING_BODY % "unknown-ticket-bbbbbbbbbbbbbbbbbbbbbbbbb").encode()
    body = body[:-1] + b',"messengerId":"999999"}'
    r = await client.post(
        "/api/bookings", content=body, headers={"x-forwarded-for": "198.51.100.4"}
    )
    assert r.status_code == 404


async def test_validation_error_does_not_consume_guest_ticket(client, fake_redis):
    """Order pin: the decode dependency runs BEFORE the ticket stage —
    a body that fails validation must leave the ticket redeemable.
    With ADR-024 B1 the same holds one stage further: a domain refusal
    (here, a slot that does not exist) leaves it intact too."""
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
    # Valid body with the same ticket, pointing at a slot that does not
    # exist: the domain refusal (404 SlotGone) runs before redemption,
    # so the ticket survives intact.
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
    # 10/min per IP — the manageToken is a brute-forceable credential,
    # so cancel is throttled like booking creation.
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
    # A signed-in organizer passes the guard, then fails body validation
    # — proving the guard and the decode are separate doors.
    r = await client.post(
        "/api/bookings/cancel-by-organizer",
        content=b'{"bookingId":',
        headers=organizer_headers("01930000-0000-7000-8000-0000000000c1"),
    )
    assert r.status_code == 400


# ── publish_outbox_rows ──────────────────────────────────────────────────────


async def test_publish_outbox_rows_absorbs_publish_errors(monkeypatch):
    """The publisher absorbs its own errors (ADR-012): the booking is
    already committed, so a failing publish must not fail anything — the
    row stays `pending` and the sweeper retries it."""
    from countmein.routes import bookings as bookings_route

    monkeypatch.setenv("QSTASH_TOKEN", "test-token")
    monkeypatch.setenv("QSTASH_URL", "http://127.0.0.1:1")  # unreachable — fails fast
    monkeypatch.setenv("APP_URL", "https://example.com")

    rows = [
        OutboxRow(
            id="01930000-0000-7000-8000-0000000000d1",
            queue="booking.created",
            payload='{"bookingId":"x","recipient":"organizer"}',
            trace_id="",
            status="pending",
            attempts=0,
        ),
        OutboxRow(
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
    """Cleanup: booking rows first, then the organizer (its delete
    cascades services + slots)."""
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
    # …and the fan-out rows are durable + pending (publish failed into
    # the void, so the sweeper must still see them).
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
    # The dialog renders "how many are left" from the extras, not just
    # the localized copy — the wiring must carry seatsLeft through.
    b = json.loads(r.content)
    assert b.get("seatsLeft") == 0
    assert b.get("error"), "409 must carry localized error copy"


async def test_booking_create_sold_out_leaves_ticket(client, fake_redis, monkeypatch):
    """ADR-024 B1: a domain refusal must not burn the guest ticket —
    after a 409 the same ticket stays redeemable (the guest retries
    with different seats without re-running the widget)."""
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
    """A forged/expired ticket on a bookable slot: the seat is claimed
    and released by the rollback — the refusal is 401 and booked_count
    is unchanged."""
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
