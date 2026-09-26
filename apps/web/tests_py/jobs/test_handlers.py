"""Port of pkg/jobs/handlers_test.go — the notification handlers. One
job per recipient (ADR-012), the counterparty-only rule for
cancellations, the demo refusal (ADR-010), the one-time login link
minted per send attempt, and the outbox sweeper.

The handlers read the booking chain fresh from Postgres at send time,
so these are integration tests: real Postgres (like the db tests) plus
fakeredis for the login links and a fake Bot API transport for
send_message."""

import os
import uuid
from datetime import UTC, datetime, timedelta

import _lib.countmein.jobs.telegram as telegram_mod
import pytest
from _lib.countmein import redis as redis_mod
from _lib.countmein.contracts import models_gen as gen
from _lib.countmein.db.client import engine
from _lib.countmein.db.shared import hash_manage_token
from _lib.countmein.jobs.booking_cancelled import handle_booking_cancelled
from _lib.countmein.jobs.booking_created import handle_booking_created
from _lib.countmein.jobs.env import Env
from _lib.countmein.jobs.links import cabinet_slot_path

pytestmark = pytest.mark.skipif(
    os.getenv("POSTGRES_URL", "") == "" and os.getenv("CI") != "true",
    reason="POSTGRES_URL is not set — integration test needs the docker Postgres",
)


@pytest.fixture(scope="module")
def fake_redis():
    import fakeredis.aioredis

    fake = fakeredis.aioredis.FakeRedis()
    prev = redis_mod.client
    redis_mod.client = lambda: fake
    os.environ.setdefault("REDIS_URL", "redis://fake")
    yield fake
    redis_mod.client = prev


class FakeTelegram:
    def __init__(self):
        self.calls: list[dict] = []

    def __call__(self, url, content=None, headers=None, timeout=None):
        import json

        body = json.loads(content or b"{}")
        markup = body.get("reply_markup")
        button = ""
        if markup and markup.get("inline_keyboard"):
            button = markup["inline_keyboard"][0][0].get("url", "")
        self.calls.append(
            {"chat_id": body.get("chat_id"), "text": body.get("text"), "button": button}
        )
        import httpx

        return httpx.Response(200, json={"ok": True})


@pytest.fixture()
def fake_telegram(monkeypatch):
    ft = FakeTelegram()
    monkeypatch.setattr(telegram_mod, "_post", ft)
    yield ft
    telegram_mod._reset_for_test()


@pytest.fixture()
async def fixture_rows():
    org_id = str(uuid.uuid7()) if hasattr(uuid, "uuid7") else str(uuid.uuid4())
    suffix = org_id.replace("-", "")[-12:]
    slug = "it-jobs-" + suffix
    org_chat = "it-org-chat-" + suffix[-8:]
    guest_chat = "it-guest-chat-" + suffix[-8:]
    async with engine().begin() as conn:
        await conn.execute(
            __import__("sqlalchemy").text(
                "INSERT INTO organizers (id, slug, name, messenger, messenger_id, timezone, language) "
                "VALUES (CAST(:id AS uuid), :slug, 'IT Organizer', 'telegram', :chat, 'Europe/Belgrade', 'en')"
            ),
            {"id": org_id, "slug": slug, "chat": org_chat},
        )
        service_id = "svc-" + suffix
        await conn.execute(
            __import__("sqlalchemy").text(
                "INSERT INTO services (id, organizer_id, title, default_price, default_capacity, "
                "default_duration_minutes, max_seats_per_booking) "
                "VALUES (:id, CAST(:org AS uuid), 'IT Service', '10 EUR', 10, 60, 4)"
            ),
            {"id": service_id, "org": org_id},
        )
        slot_id = str(uuid.uuid4())
        await conn.execute(
            __import__("sqlalchemy").text(
                "INSERT INTO time_slots (id, service_id, starts_at, duration_minutes, capacity, booked_count) "
                "VALUES (CAST(:id AS uuid), :svc, :starts, 60, 10, 1)"
            ),
            {
                "id": slot_id,
                "svc": service_id,
                "starts": datetime.now(tz=UTC) + timedelta(hours=48),
            },
        )
        booking_id = str(uuid.uuid4())
        token = "it-manage-token-" + suffix
        await conn.execute(
            __import__("sqlalchemy").text(
                "INSERT INTO bookings (id, time_slot_id, status, seats, guest_name, guest_messenger, "
                "guest_messenger_id, guest_locale, manage_token, manage_token_hash) "
                "VALUES (CAST(:id AS uuid), CAST(:slot AS uuid), 'confirmed', 2, 'Ann', 'telegram', :chat, 'en', :token, :hash)"
            ),
            {
                "id": booking_id,
                "slot": slot_id,
                "chat": guest_chat,
                "token": token,
                "hash": hash_manage_token(token),
            },
        )
    yield {
        "organizer_id": org_id,
        "organizer_slug": slug,
        "organizer_chat": org_chat,
        "guest_chat": guest_chat,
        "slot_id": slot_id,
        "booking_id": booking_id,
        "manage_token": token,
    }
    async with engine().begin() as conn:
        await conn.execute(
            __import__("sqlalchemy").text("DELETE FROM bookings WHERE id = CAST(:id AS uuid)"),
            {"id": booking_id},
        )
        await conn.execute(
            __import__("sqlalchemy").text("DELETE FROM organizers WHERE id = CAST(:id AS uuid)"),
            {"id": org_id},
        )


ENV = Env(telegram_bot_token="it-bot-token", app_url="https://example.com")


async def test_handle_booking_created_per_recipient(fixture_rows, fake_telegram, fake_redis):
    """One job per recipient: the handler sends exactly one message, to
    the job's recipient, with audience-specific content — the organizer
    gets the guest contact line and a one-time cabinet link, the guest
    gets the organizer details and their manage URL."""
    job = gen.BookingCreatedJob.model_construct(
        bookingId=fixture_rows["booking_id"], recipient="organizer"
    )
    await handle_booking_created(ENV, job, "trace-1")
    job.recipient = "guest"
    await handle_booking_created(ENV, job, "trace-1")

    calls = fake_telegram.calls
    assert len(calls) == 2, "one job per recipient → exactly 2 sends"
    org_call, guest_call = calls
    assert org_call["chat_id"] == fixture_rows["organizer_chat"]
    assert guest_call["chat_id"] == fixture_rows["guest_chat"]
    assert "Ann" in org_call["text"], "organizer message must lead with the guest"
    assert "IT Organizer" in guest_call["text"], "guest message must name the organizer"
    assert "/booking/" in guest_call["button"], "guest button must be the manage URL"
    assert "/login/link/" in org_call["button"], "organizer button must be a one-time login link"


async def test_handle_booking_created_mints_login_link(fixture_rows, fake_telegram, fake_redis):
    """The organizer's deep link is a real one-time login link:
    {organizerId, next} minted in Redis, next scoped to the booked
    slot."""
    from _lib.countmein.auth.ticket import peek_login_link

    job = gen.BookingCreatedJob.model_construct(
        bookingId=fixture_rows["booking_id"], recipient="organizer"
    )
    await handle_booking_created(ENV, job, "trace-2")

    calls = fake_telegram.calls
    assert len(calls) == 1
    token = calls[0]["button"].removeprefix("https://example.com/login/link/")
    payload = await peek_login_link(token)
    assert payload is not None, "login link must be minted in Redis"
    assert payload.organizer_id == fixture_rows["organizer_id"]
    assert payload.next == cabinet_slot_path(fixture_rows["slot_id"]), (
        "login link next must be the slot-filtered cabinet path"
    )


async def test_handle_booking_cancelled_counterparty_only(fixture_rows, fake_telegram, fake_redis):
    """Only the counterparty is notified: cancelledBy=guest → the
    organizer hears about it, cancelledBy=organizer → the guest does."""
    by_guest = gen.BookingCancelledJob.model_construct(
        bookingId=fixture_rows["booking_id"], cancelledBy="guest"
    )
    await handle_booking_cancelled(ENV, by_guest, "trace-4")
    by_organizer = gen.BookingCancelledJob.model_construct(
        bookingId=fixture_rows["booking_id"], cancelledBy="organizer"
    )
    await handle_booking_cancelled(ENV, by_organizer, "trace-4")

    calls = fake_telegram.calls
    assert len(calls) == 2, "two jobs → two sends"
    assert calls[0]["chat_id"] == fixture_rows["organizer_chat"], (
        "guest cancelled → the organizer is notified"
    )
    assert calls[1]["chat_id"] == fixture_rows["guest_chat"], (
        "organizer cancelled → the guest is notified"
    )
    # The cancelled guest gets the organizer's public page (rebook), not
    # a manage link — the booking is gone.
    want_page = "https://example.com/" + fixture_rows["organizer_slug"]
    assert calls[1]["button"] == want_page


async def test_handle_booking_missing_is_silent_skip(fake_telegram, fake_redis):
    """A booking id that matches nothing is a silent skip too (a retry
    that arrives after the row was deleted must not fail the
    delivery)."""
    missing = gen.BookingCreatedJob.model_construct(
        bookingId=str(uuid.uuid4()), recipient="organizer"
    )
    await handle_booking_created(ENV, missing, "trace-missing")
    assert fake_telegram.calls == []


async def test_handle_booking_demo_refused(fake_telegram, fake_redis):
    """A demo booking is never notified (ADR-010): every recipient path
    is a silent skip — no Telegram sends, and no one-time login link
    minted in Redis either."""
    from _lib.countmein.contracts.constants_gen import DEMO_ORGANIZER_ID
    from sqlalchemy import text

    # A booking chain hanging off the demo organizer (the row itself is
    # seed-owned; the service/slot/booking below are ours to clean up).
    suffix = uuid.uuid4().hex[-12:]
    service_id = "svc-demo-" + suffix
    slot_id = str(uuid.uuid4())
    booking_id = str(uuid.uuid4())
    token = "it-demo-token-" + suffix
    async with engine().begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO services (id, organizer_id, title, default_price, default_capacity, "
                "default_duration_minutes, max_seats_per_booking) "
                "VALUES (:id, CAST(:org AS uuid), 'Demo Service', '0', 10, 60, 4)"
            ),
            {"id": service_id, "org": DEMO_ORGANIZER_ID},
        )
        await conn.execute(
            text(
                "INSERT INTO time_slots (id, service_id, starts_at, duration_minutes, capacity, booked_count) "
                "VALUES (CAST(:id AS uuid), :svc, :starts, 60, 10, 0)"
            ),
            {
                "id": slot_id,
                "svc": service_id,
                "starts": datetime.now(tz=UTC) + timedelta(hours=48),
            },
        )
        await conn.execute(
            text(
                "INSERT INTO bookings (id, time_slot_id, status, seats, guest_name, guest_messenger, "
                "guest_messenger_id, guest_locale, manage_token, manage_token_hash) "
                "VALUES (CAST(:id AS uuid), CAST(:slot AS uuid), 'confirmed', 1, 'Ann', 'telegram', "
                ":chat, 'en', :token, :hash)"
            ),
            {
                "id": booking_id,
                "slot": slot_id,
                "chat": "it-demo-chat-" + suffix[-8:],
                "token": token,
                "hash": hash_manage_token(token),
            },
        )
    try:
        links_before = await fake_redis.keys("auth:login-link:*")

        created = gen.BookingCreatedJob.model_construct(bookingId=booking_id, recipient="organizer")
        await handle_booking_created(ENV, created, "trace-demo")
        created.recipient = "guest"
        await handle_booking_created(ENV, created, "trace-demo")
        for by in ("guest", "organizer"):
            cancelled = gen.BookingCancelledJob.model_construct(
                bookingId=booking_id, cancelledBy=by
            )
            await handle_booking_cancelled(ENV, cancelled, "trace-demo")

        assert fake_telegram.calls == [], "demo booking → no sends"
        # Neither recipient path may mint its one-time login link —
        # checked by key prefix, not a bare key count (a count could
        # hide a mint plus an unrelated expiry).
        links_after = await fake_redis.keys("auth:login-link:*")
        assert links_after == links_before, "demo booking must mint no login links"
    finally:
        async with engine().begin() as conn:
            await conn.execute(
                text("DELETE FROM bookings WHERE id = CAST(:id AS uuid)"), {"id": booking_id}
            )
            await conn.execute(
                text("DELETE FROM time_slots WHERE id = CAST(:id AS uuid)"), {"id": slot_id}
            )
            await conn.execute(text("DELETE FROM services WHERE id = :id"), {"id": service_id})
