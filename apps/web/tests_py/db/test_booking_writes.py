"""The booking-write tests: the atomic seat reserve, delete guards and
the booking write invariants, against a real Postgres:
the atomic seat reserve, the idempotent cancel, the manageToken hash
lookup, the demo refusal inside the transaction, and the transactional
outbox rows. Mocks cannot test the conditional UPDATE (invariant 2): the
whole point is that Postgres evaluates the predicate against the row it
locks.

Runs against the local docker Postgres when POSTGRES_URL is set and
migrated (docker-compose.yml + drizzle migrations); skipped locally
without it, failed in CI (the workflow provides the service).
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import pytest
from _lib.countmein.contracts.constants_gen import (
    DEMO_ORGANIZER_ID,
    QUEUE_BOOKING_CANCELLED,
    QUEUE_BOOKING_CREATED,
)
from _lib.countmein.contracts.payloads import AuthTicketPayload
from _lib.countmein.db import (
    booking_writes as bw,
)
from _lib.countmein.db import (
    media,
)
from _lib.countmein.db import (
    organizer as organizer_db,
)
from _lib.countmein.db import (
    service as service_db,
)
from _lib.countmein.db import (
    timeslot as slot_db,
)
from _lib.countmein.db.client import engine
from _lib.countmein.db.errors import (
    AlreadyCancelled,
    BookingNotFound,
    DuplicateBooking,
    InvalidOptions,
    PartyTooLarge,
    ServiceHasBookings,
    SlotGone,
    SlotHasActiveBookings,
    SoldOut,
)
from _lib.countmein.db.shared import (
    hash_manage_token,
    new_id,
    new_manage_token,
    new_service_id,
)
from _lib.countmein.demo.errors import DemoReadOnlyError
from sqlalchemy import text


def require_postgres() -> None:
    # The shared rule: skip locally, fail in CI (a silent skip would
    # leave the booking invariants unverified while the pipeline stays
    # green).
    from _env import require_postgres as _require

    _require()


@dataclass
class SlotSpec:
    starts_at: datetime = field(default_factory=lambda: datetime.now(UTC) + timedelta(hours=48))
    capacity: int = 10
    booked: int = 0
    max_seats: int = 4
    options: list[str] | None = None
    select_mode: str = ""


@dataclass
class Fixture:
    """One organizer + one service + one future slot, unique per test run
    (uuid suffixes) so parallel runs never collide. Everything cascades
    from the organizer row on cleanup once the bookings are gone."""

    organizer_id: str
    service_id: str
    slot_id: str
    booking_ids: list[str] = field(default_factory=list)

    def track(self, id_: str) -> str:
        self.booking_ids.append(id_)
        return id_

    async def cleanup(self) -> None:
        async with engine().begin() as conn:
            # Outbox rows carry no FK — remove by the booking ids they reference.
            if self.booking_ids:
                await conn.execute(
                    text(
                        "DELETE FROM notification_outbox "
                        "WHERE (payload::jsonb->>'bookingId')::text = ANY(:ids)"
                    ),
                    {"ids": self.booking_ids},
                )
                await conn.execute(
                    text("DELETE FROM bookings WHERE id::text = ANY(:ids)"),
                    {"ids": self.booking_ids},
                )
            # Cascades services + slots.
            await conn.execute(
                text("DELETE FROM organizers WHERE id = :id"), {"id": self.organizer_id}
            )

    async def booked_count(self) -> int:
        async with engine().connect() as conn:
            result = await conn.execute(
                text("SELECT booked_count FROM time_slots WHERE id = :id"),
                {"id": self.slot_id},
            )
            row = result.first()
            assert row is not None
            return int(row[0])

    async def insert_booking(self, seats: int, expires_at: datetime | None) -> tuple[str, str]:
        id_ = self.track(new_id())
        token = new_manage_token()
        async with engine().begin() as conn:
            await conn.execute(
                text(
                    """
                    INSERT INTO bookings (id, time_slot_id, status, seats, guest_name, guest_messenger,
                        guest_messenger_id, guest_locale, manage_token, manage_token_hash, manage_token_expires_at)
                    VALUES (:id, :slot_id, 'confirmed', :seats, 'Ann', 'telegram', :guest_id, 'en',
                        :token, :token_hash, :expires_at)
                    """
                ),
                {
                    "id": id_,
                    "slot_id": self.slot_id,
                    "seats": seats,
                    "guest_id": "it-guest-" + id_[-8:],
                    "token": token,
                    "token_hash": hash_manage_token(token),
                    "expires_at": expires_at,
                },
            )
        return id_, token


async def new_fixture(mutate=None) -> Fixture:
    require_postgres()
    spec = SlotSpec()
    if mutate is not None:
        mutate(spec)

    f = Fixture(organizer_id=new_id(), service_id=new_service_id(), slot_id=new_id())
    suffix = f.organizer_id[-12:]

    async with engine().begin() as conn:
        await conn.execute(
            text(
                """
                INSERT INTO organizers (id, slug, name, messenger, messenger_id, timezone, language)
                VALUES (:id, :slug, 'IT Organizer', 'telegram', :messenger_id, 'Europe/Belgrade', 'en')
                """
            ),
            {
                "id": f.organizer_id,
                "slug": "it-org-" + suffix,
                "messenger_id": "it-" + suffix,
            },
        )
        # Empty string is not a valid enum value — None means "no options".
        select_mode = spec.select_mode if spec.select_mode != "" else None
        await conn.execute(
            text(
                """
                INSERT INTO services (id, organizer_id, title, default_price, default_capacity,
                    default_duration_minutes, max_seats_per_booking, options, options_select_mode)
                VALUES (:id, :org_id, 'IT Service', '10 EUR', 10, 60, :max_seats, :options, :select_mode)
                """
            ),
            {
                "id": f.service_id,
                "org_id": f.organizer_id,
                "max_seats": spec.max_seats,
                "options": spec.options,
                "select_mode": select_mode,
            },
        )
        await conn.execute(
            text(
                """
                INSERT INTO time_slots (id, service_id, starts_at, duration_minutes, capacity, booked_count)
                VALUES (:id, :service_id, :starts_at, 60, :capacity, :booked)
                """
            ),
            {
                "id": f.slot_id,
                "service_id": f.service_id,
                "starts_at": spec.starts_at,
                "capacity": spec.capacity,
                "booked": spec.booked,
            },
        )
    return f


@pytest.fixture()
async def cleanup():
    """Register fixtures for teardown; the fixture objects register
    themselves here so cleanup runs even on assertion failure."""
    fixtures: list[Fixture] = []
    yield fixtures
    for f in fixtures:
        await f.cleanup()


def guest_identity(id_: str) -> AuthTicketPayload:
    return AuthTicketPayload(
        messenger="telegram",
        messenger_id="it-" + id_,
        display_name="Ann",
        purpose="guest",
    )


def booking_data(f: Fixture, seats: int, options, guest: AuthTicketPayload) -> bw.CreateBookingData:
    return bw.CreateBookingData(
        service_id=f.service_id,
        time_slot_id=f.slot_id,
        seats=seats,
        guest_name="Ann",
        selected_options=options,
        guest_locale="en",
        guest=guest,
        trace_id="it-trace",
    )


async def outbox_rows_for(booking_id: str) -> list[tuple]:
    async with engine().connect() as conn:
        result = await conn.execute(
            text(
                "SELECT id, queue, payload, coalesce(trace_id, ''), status::text, attempts "
                "FROM notification_outbox WHERE (payload::jsonb->>'bookingId') = :booking_id"
            ),
            {"booking_id": booking_id},
        )
        return list(result)


def _uuid_str(value) -> str:
    """GuestBooking.id is a UUIDModel root — unwrap to the plain string."""
    return str(getattr(value, "root", value))


def _root_str(value) -> str:
    """Scalar DTO fields (status, …) are RootModel roots — unwrap."""
    return str(getattr(value, "root", value))


# ── CreateGuestBooking ───────────────────────────────────────────────────────


async def test_create_guest_booking_success(cleanup):
    f = await new_fixture()
    cleanup.append(f)

    created, outbox = await bw.create_guest_booking(booking_data(f, 2, None, guest_identity("g1")))
    f.track(_uuid_str(created.id))

    assert _root_str(created.status) == "confirmed"
    assert int(getattr(created.seats, "root", created.seats)) == 2
    assert created.manageToken != "", (
        "the guest DTO must carry the manageToken (their management link)"
    )
    assert await f.booked_count() == 2, "atomic reserve"

    # Outbox: one row per recipient (organizer + guest), both pending,
    # both carrying the booking id and the trace id (ADR-012).
    assert len(outbox) == 2, "fan-out per recipient"
    recipients = set()
    for row in outbox:
        assert row.queue == QUEUE_BOOKING_CREATED
        assert row.trace_id == "it-trace"
        job = json.loads(row.payload)
        assert job["bookingId"] == _uuid_str(created.id)
        recipients.add(job["recipient"])
    assert recipients == {"organizer", "guest"}, "fan-out must cover organizer and guest"

    # The rows are durable and pending in the DB (the caller publishes
    # after commit and marks them sent).
    stored = await outbox_rows_for(_uuid_str(created.id))
    assert len(stored) == 2
    for row in stored:
        assert row[4] == "pending"


async def test_create_guest_booking_sold_out(cleanup):
    f = await new_fixture(lambda s: (setattr(s, "capacity", 3), setattr(s, "booked", 3)))
    cleanup.append(f)
    with pytest.raises(SoldOut) as exc_info:
        await bw.create_guest_booking(booking_data(f, 1, None, guest_identity("g2")))
    assert exc_info.value.seats_left == 0

    # Partial room: capacity 3, booked 2, party of 2 → 2+2 > 3, one seat left.
    f2 = await new_fixture(lambda s: (setattr(s, "capacity", 3), setattr(s, "booked", 2)))
    cleanup.append(f2)
    with pytest.raises(SoldOut) as exc_info:
        await bw.create_guest_booking(booking_data(f2, 2, None, guest_identity("g3")))
    assert exc_info.value.seats_left == 1


async def test_create_guest_booking_past_slot(cleanup):
    f = await new_fixture(lambda s: setattr(s, "starts_at", datetime.now(UTC) - timedelta(hours=2)))
    cleanup.append(f)
    with pytest.raises(SlotGone):
        await bw.create_guest_booking(booking_data(f, 1, None, guest_identity("g4")))
    assert await f.booked_count() == 0, "a refused booking must not claim seats"


async def test_create_guest_booking_party_too_large(cleanup):
    f = await new_fixture(lambda s: setattr(s, "max_seats", 2))
    cleanup.append(f)
    with pytest.raises(PartyTooLarge) as exc_info:
        await bw.create_guest_booking(booking_data(f, 3, None, guest_identity("g5")))
    assert exc_info.value.max_seats == 2
    assert await f.booked_count() == 0, "a refused booking must not claim seats"


async def test_create_guest_booking_invalid_options(cleanup):
    cases = [
        ("single with two selected", ["a", "b"], "single", ["a", "b"]),
        ("unknown option", ["a", "b"], "multi", ["nope"]),
        ("duplicate option", ["a", "b"], "multi", ["a", "a"]),
        ("options on an optionless service", None, "", ["a"]),
    ]
    for _name, options, mode, selected in cases:
        f = await new_fixture(
            lambda s, o=options, m=mode: (setattr(s, "options", o), setattr(s, "select_mode", m))
        )
        cleanup.append(f)
        with pytest.raises(InvalidOptions):
            await bw.create_guest_booking(booking_data(f, 1, selected, guest_identity("g6")))


async def test_create_guest_booking_duplicate(cleanup):
    f = await new_fixture()
    cleanup.append(f)
    guest = guest_identity("g7")

    first, _ = await bw.create_guest_booking(booking_data(f, 1, None, guest))
    f.track(_uuid_str(first.id))

    # Same guest, same slot: the partial unique index rejects the second
    # INSERT with a 23505 → DuplicateBooking, and the transaction
    # rolls back — releasing the seat the second attempt had claimed.
    with pytest.raises(DuplicateBooking):
        await bw.create_guest_booking(booking_data(f, 2, None, guest))
    assert await f.booked_count() == 1, "rollback must release the claimed seats"

    # A different guest may still book the same slot.
    other, _ = await bw.create_guest_booking(booking_data(f, 1, None, guest_identity("g8")))
    f.track(_uuid_str(other.id))


async def test_create_guest_booking_demo_refused(cleanup):
    require_postgres()

    # The demo organizer row (seeded by seed_demo; insert defensively if
    # the local DB was never seeded — the guard only needs the chain).
    async with engine().begin() as conn:
        await conn.execute(
            text(
                """
                INSERT INTO organizers (id, slug, name, messenger, messenger_id, timezone, language)
                VALUES (:id, 'demo', 'Demo', 'telegram', 'demo', 'UTC', 'en')
                ON CONFLICT (id) DO NOTHING
                """
            ),
            {"id": DEMO_ORGANIZER_ID},
        )

    service_id = new_service_id()
    slot_id = new_id()
    async with engine().begin() as conn:
        await conn.execute(
            text(
                """
                INSERT INTO services (id, organizer_id, title, default_price, default_capacity, default_duration_minutes, max_seats_per_booking)
                VALUES (:id, :org_id, 'Demo Service', '0', 10, 60, 1)
                """
            ),
            {"id": service_id, "org_id": DEMO_ORGANIZER_ID},
        )
        await conn.execute(
            text(
                """
                INSERT INTO time_slots (id, service_id, starts_at, duration_minutes, capacity, booked_count)
                VALUES (:id, :service_id, :starts_at, 60, 10, 0)
                """
            ),
            {
                "id": slot_id,
                "service_id": service_id,
                "starts_at": datetime.now(UTC) + timedelta(hours=48),
            },
        )
    try:
        with pytest.raises(DemoReadOnlyError):
            await bw.create_guest_booking(
                bw.CreateBookingData(
                    service_id=service_id,
                    time_slot_id=slot_id,
                    seats=1,
                    guest_name="Ann",
                    selected_options=None,
                    guest_locale="en",
                    guest=guest_identity("g9"),
                    trace_id="it-trace",
                )
            )
        async with engine().connect() as conn:
            result = await conn.execute(
                text("SELECT booked_count FROM time_slots WHERE id = :id"), {"id": slot_id}
            )
            row = result.first()
            assert row is not None and int(row[0]) == 0, "demo refusal must not claim seats"
    finally:
        async with engine().begin() as conn:
            await conn.execute(text("DELETE FROM time_slots WHERE id = :id"), {"id": slot_id})
            await conn.execute(text("DELETE FROM services WHERE id = :id"), {"id": service_id})
        # The demo organizer row itself is seed-owned — never deleted here.


# ── CancelGuestBookingByToken ─────────────────────────────────────────────────


async def test_cancel_guest_booking_by_token_success(cleanup):
    f = await new_fixture(lambda s: (setattr(s, "capacity", 5), setattr(s, "booked", 2)))
    cleanup.append(f)
    booking_id, token = await f.insert_booking(2, None)

    cancelled, outbox = await bw.cancel_guest_booking_by_token(token, "it-trace")
    assert cancelled is not None, "cancel must return the booking"
    assert _root_str(cancelled.status) == "cancelled"
    assert await f.booked_count() == 0, "cancel must release the seats"

    # One outbox row — the counterparty only (guest cancels → organizer
    # is notified), carrying cancelledBy=guest (ADR-012).
    assert len(outbox) == 1
    assert outbox[0].queue == QUEUE_BOOKING_CANCELLED
    job = json.loads(outbox[0].payload)
    assert job["bookingId"] == booking_id
    assert job["cancelledBy"] == "guest"


async def test_cancel_guest_booking_idempotent(cleanup):
    f = await new_fixture(lambda s: (setattr(s, "capacity", 5), setattr(s, "booked", 2)))
    cleanup.append(f)
    _, token = await f.insert_booking(2, None)

    await bw.cancel_guest_booking_by_token(token, "it-trace")
    after_first = await f.booked_count()

    # Double-tap: the status='confirmed' predicate updates no row —
    # reported as already cancelled, never a second decrement.
    with pytest.raises(AlreadyCancelled):
        await bw.cancel_guest_booking_by_token(token, "it-trace")
    assert await f.booked_count() == after_first, "re-cancel must not double-decrement"


async def test_cancel_guest_booking_unknown_token(cleanup):
    f = await new_fixture()
    cleanup.append(f)
    _, token = await f.insert_booking(1, None)

    # Unknown token → None: the caller answers 404 without confirming
    # whether the token exists.
    assert (
        await bw.cancel_guest_booking_by_token("no-such-token-aaaaaaaaaaaaaaaaaaaa", "it-trace")
        is None
    )

    # Almost-right is still unknown: a single-char mutation of a real
    # token matches no hash.
    assert await bw.cancel_guest_booking_by_token(token + "x", "it-trace") is None

    # The SHA-256 hex itself is not a valid credential either: the lookup
    # key is hash_manage_token(input), so presenting the stored hash only
    # matches if hash(hash) == hash, which SHA-256 never yields here —
    # the raw token column is not a lookup key (ADR-020).
    assert await bw.cancel_guest_booking_by_token(hash_manage_token(token), "it-trace") is None


async def test_cancel_guest_booking_expired_token(cleanup):
    f = await new_fixture(lambda s: setattr(s, "booked", 1))
    cleanup.append(f)
    expired = datetime.now(UTC) - timedelta(hours=1)
    _, token = await f.insert_booking(1, expired)

    with pytest.raises(BookingNotFound):
        await bw.cancel_guest_booking_by_token(token, "it-trace")
    assert await f.booked_count() == 1, "an expired cancel must not release seats"


# ── CancelOwnedBooking ────────────────────────────────────────────────────────


async def test_cancel_owned_booking_success(cleanup):
    f = await new_fixture(lambda s: (setattr(s, "capacity", 5), setattr(s, "booked", 3)))
    cleanup.append(f)
    booking_id, _ = await f.insert_booking(3, None)

    record, outbox = await bw.cancel_owned_booking(f.organizer_id, booking_id, "it-trace")
    assert record is not None
    assert _root_str(record.status) == "cancelled"
    assert await f.booked_count() == 0, "cancel must release the seats"

    # The guest is notified — one row, cancelledBy=organizer.
    assert len(outbox) == 1
    assert outbox[0].queue == QUEUE_BOOKING_CANCELLED
    job = json.loads(outbox[0].payload)
    assert job["bookingId"] == booking_id
    assert job["cancelledBy"] == "organizer"


async def test_cancel_owned_booking_foreign_service(cleanup):
    # A booking on someone else's service is answered exactly like an
    # unknown id — None, not an error — so the endpoint cannot probe.
    mine = await new_fixture()
    cleanup.append(mine)
    theirs = await new_fixture(lambda s: setattr(s, "booked", 1))
    cleanup.append(theirs)
    booking_id, _ = await theirs.insert_booking(1, None)

    assert await bw.cancel_owned_booking(mine.organizer_id, booking_id, "it-trace") is None
    assert await theirs.booked_count() == 1, "a foreign cancel must not release seats"

    # Unknown booking id: same answer.
    assert await bw.cancel_owned_booking(mine.organizer_id, new_id(), "it-trace") is None


async def test_cancel_owned_booking_demo_refused(cleanup):
    f = await new_fixture(lambda s: setattr(s, "booked", 1))
    cleanup.append(f)
    booking_id, _ = await f.insert_booking(1, None)

    with pytest.raises(DemoReadOnlyError):
        await bw.cancel_owned_booking(DEMO_ORGANIZER_ID, booking_id, "it-trace")
    assert await f.booked_count() == 1, "demo refusal must not release seats"


# ── Atomic reserve under contention (invariant 2) ────────────────────────────


async def test_create_guest_booking_concurrent_last_seats(cleanup):
    # Ten guests race for five seats. Postgres evaluates the conditional
    # UPDATE's predicate against the row it locks, so exactly five must
    # win and booked_count must end at capacity — never above. A
    # read-check-write implementation would overbook here.
    f = await new_fixture(lambda s: (setattr(s, "capacity", 5), setattr(s, "booked", 0)))
    cleanup.append(f)

    racers = 10

    async def race(i: int) -> str | None:
        # Unique guest per racer: the partial unique index must never
        # interfere — only the seat predicate decides who wins.
        try:
            created, _ = await bw.create_guest_booking(
                booking_data(f, 1, None, guest_identity(f"race-{i}"))
            )
        except SoldOut:
            return None
        return _uuid_str(created.id)

    won_ids = await asyncio.gather(*(race(i) for i in range(racers)))
    won = [id_ for id_ in won_ids if id_ is not None]
    for id_ in won:
        f.track(id_)

    assert await f.booked_count() == 5, (
        "booked_count must end exactly at capacity 5 (no overbooking)"
    )
    # Winners hold seats; losers were told sold out. booked_count is the
    # source of truth — the win/lose split must be consistent with it.
    assert len(won) == 5, "winners must be exactly capacity 5"
    assert len(won) + (racers - len(won)) == racers


# ── Delete guards ────────────────────────────────────────────────────────────


async def test_db_layer_refuses_demo_writes():
    """A direct db call with the demo (or an absent) organizer id must be
    refused before touching Postgres — the route guard is the first
    line, this is the second (ADR-010)."""
    for id_ in (DEMO_ORGANIZER_ID, ""):
        with pytest.raises(DemoReadOnlyError):
            await slot_db.delete_owned_slot(id_, new_id())
        with pytest.raises(DemoReadOnlyError):
            await service_db.delete_owned_service(id_, "svc")
        with pytest.raises(DemoReadOnlyError):
            await slot_db.create_slot(id_, None)
        with pytest.raises(DemoReadOnlyError):
            await organizer_db.update_organizer_language(id_, "en")


async def test_delete_owned_slot_refuses_cancelled_bookings(cleanup):
    """A slot whose only booking was cancelled cannot be deleted: the
    guard counts every referencing row (the FK is ON DELETE RESTRICT), so
    the route answers 409 instead of a raw 23503 → 500. Once the rows
    are gone the delete succeeds — the guard does not over-block."""
    f = await new_fixture()
    cleanup.append(f)
    expires_at = datetime.now(UTC) + timedelta(hours=1)
    booking_id, _ = await f.insert_booking(1, expires_at)
    async with engine().begin() as conn:
        await conn.execute(
            text("UPDATE bookings SET status = 'cancelled' WHERE id = :id"), {"id": booking_id}
        )

    with pytest.raises(SlotHasActiveBookings):
        await slot_db.delete_owned_slot(f.organizer_id, f.slot_id)
    async with engine().connect() as conn:
        result = await conn.execute(
            text("SELECT count(*) > 0 FROM time_slots WHERE id = :id"), {"id": f.slot_id}
        )
        assert result.first()[0], "the slot must survive a refused delete"

    async with engine().begin() as conn:
        await conn.execute(text("DELETE FROM bookings WHERE id = :id"), {"id": booking_id})
    deleted = await slot_db.delete_owned_slot(f.organizer_id, f.slot_id)
    assert deleted == f.slot_id


async def test_delete_owned_service_refuses_bookings(cleanup):
    """A service whose slots were ever booked cannot be deleted (the
    cascade would stop at the RESTRICT FK) — 409, never a 500."""
    f = await new_fixture()
    cleanup.append(f)
    expires_at = datetime.now(UTC) + timedelta(hours=1)
    await f.insert_booking(1, expires_at)

    with pytest.raises(ServiceHasBookings):
        await service_db.delete_owned_service(f.organizer_id, f.service_id)


# ── Media ────────────────────────────────────────────────────────────────────


async def test_photo_url_referenced(cleanup):
    """PhotoURLReferenced gates the R2 cleanup that follows a
    replace/delete: the ownership check accepts any URL under the
    organizer's prefix, so two rows can legally share one object — it
    must survive while any row still serves it."""
    f = await new_fixture()
    cleanup.append(f)
    url = f"https://media.example.com/organizers/{f.organizer_id}/services/photo-abcd1234.png"

    async with engine().connect() as conn:
        assert not await media.photo_url_referenced(conn, f.organizer_id, url), (
            "no row points at the url yet"
        )

    async with engine().begin() as conn:
        await conn.execute(
            text("UPDATE services SET photo_url = :url WHERE id = :id"),
            {"url": url, "id": f.service_id},
        )
    async with engine().connect() as conn:
        assert await media.photo_url_referenced(conn, f.organizer_id, url), (
            "a service cover must count as a reference"
        )

    async with engine().begin() as conn:
        await conn.execute(
            text("UPDATE services SET photo_url = NULL WHERE id = :id"), {"id": f.service_id}
        )
        await conn.execute(
            text("UPDATE organizers SET photo_url = :url WHERE id = :id"),
            {"url": url, "id": f.organizer_id},
        )
    async with engine().connect() as conn:
        assert await media.photo_url_referenced(conn, f.organizer_id, url), (
            "an organizer avatar must count as a reference"
        )

    async with engine().begin() as conn:
        await conn.execute(
            text("UPDATE organizers SET photo_url = NULL WHERE id = :id"), {"id": f.organizer_id}
        )
    async with engine().connect() as conn:
        assert not await media.photo_url_referenced(conn, f.organizer_id, url), (
            "no row references the url — cleanup may proceed"
        )
