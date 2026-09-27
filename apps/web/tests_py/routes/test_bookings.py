"""The booking routes'
request-level contracts: rate limits, body validation, the ticket door,
the demo/anonymous refusal, and the after-commit publish absorbing its
own errors. The DB-dependent paths (sold-out mapping, 201 happy path)
are pinned by the integration tests in tests_py/db against a real
Postgres; mocks would hide exactly the class of bugs those exist for."""

import json
import os
import time
from collections.abc import Mapping

import _lib.countmein.routes.bookings as bookings_route
import pytest
from _lib.countmein import redis as redis_mod
from _lib.countmein.auth.session import ORGANIZER_AUTH_HEADER
from _lib.countmein.auth.telegram import TICKET_PURPOSE_GUEST
from _lib.countmein.auth.ticket import issue_ticket
from _lib.countmein.contracts.constants_gen import DEMO_ORGANIZER_ID, DEMO_READ_ONLY_CODE
from _lib.countmein.contracts.payloads import AuthTicketPayload
from _lib.countmein.db.outbox import OutboxRow

TEST_SECRET = "routes-test-golden-secret"

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


def make_request(path: str, body: bytes, headers: Mapping[str, str]):
    from starlette.requests import Request

    scope = {
        "type": "http",
        "method": "POST",
        "path": path,
        "raw_path": path.encode(),
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "query_string": b"",
        "client": ("127.0.0.1", 12345),
        "scheme": "http",
        "server": ("testserver", 80),
        "http_version": "1.1",
    }
    request = Request(scope)
    request._body = body
    return request


def decode_body_error(response) -> dict:
    body = response.body.decode() if getattr(response, "body", None) else ""
    return json.loads(body)


def mint_test_token(secret: str, sub: str, slug: str, exp: int) -> str:
    """The shared organizer-auth mint (the derivation itself is pinned
    by the golden test in tests_py/auth/test_session.py)."""
    import base64
    import hashlib
    import hmac

    from _lib.countmein.auth.session import derived_signing_key

    header = (
        base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
        .rstrip(b"=")
        .decode()
    )
    payload = (
        base64.urlsafe_b64encode(
            json.dumps({"sub": sub, "slug": slug, "iat": int(time.time()), "exp": exp}).encode()
        )
        .rstrip(b"=")
        .decode()
    )
    signing_input = f"{header}.{payload}"
    sig = hmac.new(derived_signing_key(secret), signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{base64.urlsafe_b64encode(sig).rstrip(b'=').decode()}"


# ── BookingCreate ────────────────────────────────────────────────────────────


async def test_booking_create_rate_limit(fake_redis):
    # 5/min per IP. The first five requests burn the bucket (each fails
    # body validation — 400, but AFTER the limiter), the sixth is a 429.
    for i in range(5):
        request = make_request("/api/bookings", b"", {"x-forwarded-for": "198.51.100.1"})
        response = await bookings_route.booking_create(request)
        assert response.status_code == 400, f"request {i + 1}"
    request = make_request("/api/bookings", b"", {"x-forwarded-for": "198.51.100.1"})
    response = await bookings_route.booking_create(request)
    assert response.status_code == 429
    assert "retry-after" in {k.lower() for k in response.headers.keys()}


async def test_booking_create_invalid_body(fake_redis):
    request = make_request("/api/bookings", b'{"guestName":', {"x-forwarded-for": "198.51.100.2"})
    response = await bookings_route.booking_create(request)
    assert response.status_code == 400
    body = decode_body_error(response)
    assert body.get("error"), "400 must carry localized error copy"


async def test_booking_create_unknown_ticket(fake_redis):
    # Schema-valid body, unknown ticket: the guest identity door refuses
    # before any DB access — a replayed or forged ticket must never
    # reach the booking transaction.
    body = (VALID_BOOKING_BODY % "unknown-ticket-aaaaaaaaaaaaaaaaaaaaaaaaa").encode()
    request = make_request("/api/bookings", body, {"x-forwarded-for": "198.51.100.3"})
    response = await bookings_route.booking_create(request)
    assert response.status_code == 401


async def test_booking_create_raw_messenger_id_ignored(fake_redis):
    # Invariant 8: identity comes only from the ticket. A body claiming
    # a messengerId must not authenticate the request — the unknown
    # ticket still refuses it with a 401.
    body = (VALID_BOOKING_BODY % "unknown-ticket-bbbbbbbbbbbbbbbbbbbbbbbbb").encode()
    body = body[:-1] + b',"messengerId":"999999"}'
    request = make_request("/api/bookings", body, {"x-forwarded-for": "198.51.100.4"})
    response = await bookings_route.booking_create(request)
    assert response.status_code == 401


# ── BookingLookup ────────────────────────────────────────────────────────────


async def test_booking_lookup_invalid_body(fake_redis):
    request = make_request("/api/bookings/lookup", b"{", {"x-forwarded-for": "198.51.100.5"})
    response = await bookings_route.booking_lookup(request)
    assert response.status_code == 400


async def test_booking_lookup_unknown_ticket(fake_redis):
    request = make_request(
        "/api/bookings/lookup",
        b'{"guestTicket":"unknown-ticket-ccccccccccccccccccccccc"}',
        {"x-forwarded-for": "198.51.100.6"},
    )
    response = await bookings_route.booking_lookup(request)
    assert response.status_code == 401


# ── BookingCancel ────────────────────────────────────────────────────────────


async def test_booking_cancel_rate_limit(fake_redis):
    # 10/min per IP — the manageToken is a brute-forceable credential,
    # so cancel is throttled like booking creation.
    for i in range(10):
        request = make_request("/api/bookings/cancel", b"", {"x-forwarded-for": "198.51.100.7"})
        response = await bookings_route.booking_cancel(request)
        assert response.status_code == 400, f"request {i + 1}"
    request = make_request("/api/bookings/cancel", b"", {"x-forwarded-for": "198.51.100.7"})
    response = await bookings_route.booking_cancel(request)
    assert response.status_code == 429


async def test_booking_cancel_invalid_body(fake_redis):
    request = make_request(
        "/api/bookings/cancel", b'{"manageToken":', {"x-forwarded-for": "198.51.100.8"}
    )
    response = await bookings_route.booking_cancel(request)
    assert response.status_code == 400


# ── BookingCancelByOrganizer ─────────────────────────────────────────────────


def organizer_request(path: str, body: bytes, organizer_id: str):
    headers = {}
    if organizer_id:
        token = mint_test_token(TEST_SECRET, organizer_id, "studio", int(time.time()) + 60)
        headers[ORGANIZER_AUTH_HEADER] = token
    return make_request(path, body, headers)


async def test_booking_cancel_by_organizer_anonymous(fake_redis):
    # /cabinet needs no session (ADR-010) — an anonymous visitor is a
    # demo-cabinet visitor and must not cancel anyone's booking.
    request = organizer_request(
        "/api/bookings/cancel-by-organizer",
        b'{"bookingId":"01930000-0000-7000-8000-000000000001"}',
        "",
    )
    response = await bookings_route.booking_cancel_by_organizer(request)
    assert response.status_code == 403
    body = decode_body_error(response)
    assert body.get("code") == DEMO_READ_ONLY_CODE


async def test_booking_cancel_by_organizer_demo_session(fake_redis):
    request = organizer_request(
        "/api/bookings/cancel-by-organizer",
        b'{"bookingId":"01930000-0000-7000-8000-000000000001"}',
        DEMO_ORGANIZER_ID,
    )
    response = await bookings_route.booking_cancel_by_organizer(request)
    assert response.status_code == 403


async def test_booking_cancel_by_organizer_invalid_body(fake_redis):
    # A signed-in organizer passes the guard, then fails body validation
    # — proving the guard and the decode are separate doors.
    request = organizer_request(
        "/api/bookings/cancel-by-organizer",
        b'{"bookingId":',
        "01930000-0000-7000-8000-0000000000c1",
    )
    response = await bookings_route.booking_cancel_by_organizer(request)
    assert response.status_code == 400


# ── publish_outbox_rows ──────────────────────────────────────────────────────


async def test_publish_outbox_rows_absorbs_publish_errors(monkeypatch):
    """The publisher absorbs its own errors (ADR-012): the booking is
    already committed, so a failing publish must not fail anything — the
    row stays `pending` and the sweeper retries it."""
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
    if not os.environ.get("POSTGRES_URL"):
        if os.environ.get("CI") == "true":
            pytest.fail(
                "POSTGRES_URL is not set in CI — Postgres service misconfigured, "
                "refusing silent skip"
            )
        pytest.skip("POSTGRES_URL is not set — integration test needs the docker Postgres")


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

    from _lib.countmein.db.client import engine
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
    from _lib.countmein.db.client import engine
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


async def test_booking_create_happy_path(fake_redis, monkeypatch):
    fixture = await new_route_fixture(10, 0)
    try:
        await _happy_path(fixture, monkeypatch)
    finally:
        await _cleanup_route_fixture(fixture)


async def _happy_path(fixture, monkeypatch):
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
    request = make_request("/api/bookings", body, {"x-forwarded-for": "203.0.113.21"})
    response = await bookings_route.booking_create(request)

    assert response.status_code == 201, response.body
    envelope = json.loads(response.body)
    booking = envelope["booking"]
    assert booking["manageToken"], "the guest DTO must carry the manageToken"
    booking_id = booking["id"]
    fixture.booking_ids.append(booking_id)

    # Seats claimed…
    from _lib.countmein.db.client import engine
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


async def test_booking_create_sold_out_maps_409(fake_redis, monkeypatch):
    fixture = await new_route_fixture(2, 2)  # full slot
    try:
        await _sold_out(fixture, monkeypatch)
    finally:
        await _cleanup_route_fixture(fixture)


async def _sold_out(fixture, monkeypatch):
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
    request = make_request("/api/bookings", body, {"x-forwarded-for": "203.0.113.22"})
    response = await bookings_route.booking_create(request)

    assert response.status_code == 409, response.body
    # The dialog renders "how many are left" from the extras, not just
    # the localized copy — the wiring must carry seatsLeft through.
    b = json.loads(response.body)
    assert b.get("seatsLeft") == 0
    assert b.get("error"), "409 must carry localized error copy"


async def test_booking_cancel_unknown_token_is_404(fake_redis):
    fixture = await new_route_fixture(10, 0)  # schema must exist; token matches nothing
    try:
        await _cancel_unknown_token()
    finally:
        await _cleanup_route_fixture(fixture)


async def _cancel_unknown_token():
    request = make_request(
        "/api/bookings/cancel",
        b'{"manageToken":"' + b"a" * 43 + b'"}',
        {"x-forwarded-for": "203.0.113.23"},
    )
    response = await bookings_route.booking_cancel(request)
    assert response.status_code == 404, response.body
