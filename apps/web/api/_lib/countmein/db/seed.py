"""Demo organizer seed data (ADR-010) — the only copy of the sample
content in Python.

Two rules keep this seed usable long-term:
1. Deterministic ids — re-seeding replaces rows in place instead of
   accumulating duplicates, and demo links stay stable.
2. Slot times relative to seed time, never absolute — offsets are
   resolved against `now` at seed/refresh time, anchored on "the day
   after the seed run" so a refresh always produces upcoming slots.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from ..contracts.constants_gen import (
    DEFAULT_LOCALE,
    DEMO_ORGANIZER_ID,
    DEMO_ORGANIZER_SLUG,
    DEMO_SERVICE_BREATHWORK,
    DEMO_SERVICE_POTTERY,
    DEMO_SERVICE_YOGA,
)
from ..services.booking_service import MANAGE_TOKEN_GRACE_PERIOD
from .client import sessionmaker
from .shared import hash_manage_token, new_manage_token

DEMO_TIMEZONE = "Europe/Belgrade"

# Sentinel messenger id — deliberately not a real Telegram account, so
# the demo can never be logged into via the widget.
DEMO_MESSENGER_ID = "demo-account"

DEMO_ORGANIZER_DESCRIPTION = (
    "**Boutique movement studio** in the heart of Belgrade.\n"
    "\n"
    "Small-group **yoga**, **breathwork**, and **pottery** — come as you are, _beginners always welcome_.\n"
    "\n"
    "What we offer:\n"
    "\n"
    "- 🧘 Morning Vinyasa flow\n"
    "- 🌬️ Evening breathwork circles\n"
    "- 🏺 Hand-building pottery workshops\n"
    "\n"
    "_This is a read-only demo page — [create your own](https://countmein.group/signup) in minutes._"
)
DEMO_ORGANIZER_PHOTO_URL = "/organizer-avatar.png"
DEMO_ORGANIZER_LOCATION = "Kralja Petra 123, Belgrade"
DEMO_ORGANIZER_CONTACT = "studio@studiodemo.rs"

# Deterministic demo slot ids (time_slots.id is a uuid column).
SLOT_Y1 = "01930000-0000-7000-8000-0000000a0001"
SLOT_Y2 = "01930000-0000-7000-8000-0000000a0002"
SLOT_Y3 = "01930000-0000-7000-8000-0000000a0003"
SLOT_Y4 = "01930000-0000-7000-8000-0000000a0004"
SLOT_Y5 = "01930000-0000-7000-8000-0000000a0005"
SLOT_Y6 = "01930000-0000-7000-8000-0000000a0006"
SLOT_Y7 = "01930000-0000-7000-8000-0000000a0007"
SLOT_Y8 = "01930000-0000-7000-8000-0000000a0008"
SLOT_P1 = "01930000-0000-7000-8000-0000000b0001"
SLOT_P2 = "01930000-0000-7000-8000-0000000b0002"
SLOT_P3 = "01930000-0000-7000-8000-0000000b0003"
SLOT_P4 = "01930000-0000-7000-8000-0000000b0004"
SLOT_P5 = "01930000-0000-7000-8000-0000000b0005"
SLOT_B1 = "01930000-0000-7000-8000-0000000c0001"
SLOT_B2 = "01930000-0000-7000-8000-0000000c0002"
SLOT_B3 = "01930000-0000-7000-8000-0000000c0003"
SLOT_B4 = "01930000-0000-7000-8000-0000000c0004"
SLOT_B5 = "01930000-0000-7000-8000-0000000c0005"
SLOT_B6 = "01930000-0000-7000-8000-0000000c0006"


def _booking_id(n: int) -> str:
    """Deterministic demo booking ids, 1..40 → ...0001..0028."""
    return f"01930000-0000-7000-8000-0000000d{n:04x}"


@dataclass
class DemoService:
    id: str
    title: str
    default_price: str
    default_capacity: int
    default_duration_minutes: int
    max_seats_per_booking: int
    description: str | None = None
    photo_url: str | None = None
    location: str | None = None
    contact: str | None = None
    options: list[str] | None = None
    options_select_mode: str | None = None


DEMO_SERVICES = [
    DemoService(
        id=DEMO_SERVICE_YOGA,
        title="Morning Vinyasa Flow",
        description=(
            "A dynamic 60-minute flow to wake up the body and mind. "
            "Suitable for all levels. Mats and props provided."
        ),
        photo_url="/service-yoga.png",
        default_price="$12",
        default_capacity=12,
        default_duration_minutes=60,
        max_seats_per_booking=2,
        options=["Downtown studio", "Riverside studio"],
        options_select_mode="single",
    ),
    DemoService(
        id=DEMO_SERVICE_POTTERY,
        title="Hand-Building Pottery Workshop",
        description=(
            "Shape your own mug or bowl from scratch. All clay, tools, and firing included. "
            "Great for a creative afternoon with friends."
        ),
        photo_url="/service-workshop.png",
        location="Ceramics Loft, Cetinjska 15, Belgrade",
        contact="+381 64 999 1234",
        default_price="from $25",
        default_capacity=8,
        default_duration_minutes=120,
        max_seats_per_booking=4,
        options=["Bring a friend (+1 seat)", "Take-home glaze kit", "Photo of your piece"],
        options_select_mode="multi",
    ),
    DemoService(
        id=DEMO_SERVICE_BREATHWORK,
        title="Evening Breathwork Circle",
        description=(
            "A calming 45-minute guided breathwork session to close out your day. "
            "Dim lights, warm blankets, deep rest."
        ),
        photo_url="/service-breathwork.png",
        default_price="$9",
        default_capacity=16,
        default_duration_minutes=45,
        max_seats_per_booking=1,
    ),
]


@dataclass
class SlotTemplate:
    """day_offset/hour resolve against the day *after* the seed run, so
    a refresh always produces a week of strictly upcoming slots.
    Negative day_offsets produce past slots — history for the analytics;
    they keep their bookings."""

    id: str
    service_id: str
    day_offset: int
    hour: int
    duration_minutes: int
    capacity: int
    booked_count: int
    price: str | None = None


DEMO_SLOT_TEMPLATES = [
    # Yoga — a mix of open, filling and full so the UI shows every state.
    SlotTemplate(SLOT_Y1, DEMO_SERVICE_YOGA, 0, 7, 60, 12, 9, None),
    SlotTemplate(SLOT_Y2, DEMO_SERVICE_YOGA, 1, 7, 60, 12, 12, None),
    SlotTemplate(SLOT_Y3, DEMO_SERVICE_YOGA, 2, 7, 60, 12, 4, None),
    SlotTemplate(SLOT_Y4, DEMO_SERVICE_YOGA, 3, 7, 60, 12, 1, "$14"),
    # Past yoga slots (history).
    SlotTemplate(SLOT_Y5, DEMO_SERVICE_YOGA, -3, 7, 60, 12, 12, None),
    SlotTemplate(SLOT_Y6, DEMO_SERVICE_YOGA, -10, 7, 60, 12, 10, None),
    SlotTemplate(SLOT_Y7, DEMO_SERVICE_YOGA, -17, 7, 60, 12, 8, None),
    SlotTemplate(SLOT_Y8, DEMO_SERVICE_YOGA, -24, 7, 60, 12, 11, None),
    # Pottery.
    SlotTemplate(SLOT_P1, DEMO_SERVICE_POTTERY, 1, 15, 120, 8, 5, None),
    SlotTemplate(SLOT_P2, DEMO_SERVICE_POTTERY, 4, 15, 120, 8, 8, None),
    SlotTemplate(SLOT_P3, DEMO_SERVICE_POTTERY, 6, 11, 120, 8, 2, None),
    SlotTemplate(SLOT_P4, DEMO_SERVICE_POTTERY, -5, 15, 120, 8, 8, None),
    SlotTemplate(SLOT_P5, DEMO_SERVICE_POTTERY, -19, 11, 120, 8, 6, None),
    # Breathwork.
    SlotTemplate(SLOT_B1, DEMO_SERVICE_BREATHWORK, 0, 18, 45, 16, 11, None),
    SlotTemplate(SLOT_B2, DEMO_SERVICE_BREATHWORK, 2, 18, 45, 16, 16, None),
    SlotTemplate(SLOT_B3, DEMO_SERVICE_BREATHWORK, 5, 18, 45, 16, 6, None),
    SlotTemplate(SLOT_B4, DEMO_SERVICE_BREATHWORK, -2, 18, 45, 16, 16, None),
    SlotTemplate(SLOT_B5, DEMO_SERVICE_BREATHWORK, -9, 18, 45, 16, 14, None),
    SlotTemplate(SLOT_B6, DEMO_SERVICE_BREATHWORK, -16, 18, 45, 16, 13, None),
]


@dataclass
class BookingTemplate:
    """Illustrative bookings for the cabinet's table and analytics.
    Manage tokens are generated fresh per run, never committed: demo
    rejects every write (ADR-010), but committed tokens still end up in
    backups — random per run costs nothing since slots+bookings are
    replaced wholesale on each refresh."""

    id: str
    time_slot_id: str
    cancelled: bool
    seats: int
    guest_name: str
    guest_messenger_id: str
    days_ago: int
    guest_login: str | None = None
    selected_options: list[str] | None = None


DEMO_BOOKING_TEMPLATES = [
    # ── Recent (last 7 days) — drives the trend chart. ─────────────────
    BookingTemplate(
        _booking_id(1),
        SLOT_Y1,
        False,
        2,
        "Mila Petrović",
        "demo-guest-1",
        2,
        "@milapetrovic",
        ["Downtown studio"],
    ),
    BookingTemplate(
        _booking_id(2),
        SLOT_P1,
        False,
        1,
        "Noah Ellis",
        "demo-guest-2",
        3,
        None,
        ["Take-home glaze kit", "Photo of your piece"],
    ),
    BookingTemplate(
        _booking_id(3), SLOT_B1, False, 1, "Ana Kovač", "demo-guest-3", 1, "@ana_kovac", None
    ),
    BookingTemplate(
        _booking_id(4),
        SLOT_Y3,
        False,
        3,
        "Luka Jovanović",
        "demo-guest-4",
        1,
        "@lukajovanovic",
        ["Riverside studio"],
    ),
    BookingTemplate(
        _booking_id(5), SLOT_P1, True, 1, "Sara Nikolić", "demo-guest-5", 4, "@sara_nolic", None
    ),
    BookingTemplate(
        _booking_id(6),
        SLOT_B2,
        False,
        1,
        "Elena Marković",
        "demo-guest-6",
        5,
        "@elenamarkovic",
        None,
    ),
    BookingTemplate(
        _booking_id(7), SLOT_B2, False, 1, "Filip Stanković", "demo-guest-7", 6, "@filips", None
    ),
    BookingTemplate(
        _booking_id(8),
        SLOT_Y2,
        False,
        2,
        "Jelena Popović",
        "demo-guest-8",
        6,
        "@jelenap",
        ["Downtown studio"],
    ),
    # ── 8-30 days ago — fills the 30-day window. ──────────────────────
    BookingTemplate(
        _booking_id(9),
        SLOT_Y5,
        False,
        2,
        "Marko Đorđević",
        "demo-guest-9",
        8,
        "@markod",
        ["Riverside studio"],
    ),
    BookingTemplate(
        _booking_id(10),
        SLOT_B3,
        False,
        1,
        "Tijana Radosavljević",
        "demo-guest-10",
        9,
        "@tijanar",
        None,
    ),
    BookingTemplate(
        _booking_id(11),
        SLOT_P4,
        False,
        2,
        "Andrej Simić",
        "demo-guest-11",
        10,
        "@andrejs",
        ["Bring a friend (+1 seat)"],
    ),
    BookingTemplate(
        _booking_id(12),
        SLOT_Y6,
        False,
        1,
        "Katarina Lukić",
        "demo-guest-12",
        12,
        "@katarinal",
        ["Downtown studio"],
    ),
    BookingTemplate(
        _booking_id(13), SLOT_B5, False, 1, "Nikola Vuković", "demo-guest-13", 13, "@nikolav", None
    ),
    BookingTemplate(
        _booking_id(14),
        SLOT_Y5,
        True,
        1,
        "Petra Janković",
        "demo-guest-14",
        14,
        "@petraj",
        ["Downtown studio"],
    ),
    BookingTemplate(
        _booking_id(15),
        SLOT_P4,
        False,
        1,
        "Stefan Antić",
        "demo-guest-15",
        15,
        "@stefana",
        ["Photo of your piece"],
    ),
    BookingTemplate(
        _booking_id(16),
        SLOT_Y6,
        False,
        2,
        "Olga Branković",
        "demo-guest-16",
        16,
        "@olgab",
        ["Riverside studio"],
    ),
    BookingTemplate(
        _booking_id(17), SLOT_B5, False, 1, "Dušan Pavlović", "demo-guest-17", 17, "@dusanp", None
    ),
    BookingTemplate(
        _booking_id(18),
        SLOT_Y7,
        False,
        1,
        "Maja Ilić",
        "demo-guest-18",
        18,
        "@majailic",
        ["Downtown studio"],
    ),
    BookingTemplate(
        _booking_id(19),
        SLOT_P5,
        False,
        2,
        "Bogdan Zarić",
        "demo-guest-19",
        19,
        "@bogdanz",
        ["Bring a friend (+1 seat)", "Take-home glaze kit"],
    ),
    BookingTemplate(
        _booking_id(20),
        SLOT_B6,
        False,
        1,
        "Tamara Cvetković",
        "demo-guest-20",
        20,
        "@tamarac",
        None,
    ),
    BookingTemplate(
        _booking_id(21),
        SLOT_Y7,
        False,
        2,
        "Vladimir Nikolić",
        "demo-guest-21",
        21,
        "@vladimirn",
        ["Riverside studio"],
    ),
    BookingTemplate(
        _booking_id(22),
        SLOT_P5,
        True,
        1,
        "Isidora Milovanović",
        "demo-guest-22",
        22,
        "@isidoram",
        None,
    ),
    BookingTemplate(
        _booking_id(23),
        SLOT_Y8,
        False,
        1,
        "Aleksandar Tomić",
        "demo-guest-23",
        23,
        "@aleksandart",
        ["Downtown studio"],
    ),
    BookingTemplate(
        _booking_id(24),
        SLOT_B6,
        False,
        1,
        "Natalija Pavlović",
        "demo-guest-24",
        24,
        "@natalijap",
        None,
    ),
    BookingTemplate(
        _booking_id(25),
        SLOT_Y8,
        False,
        2,
        "Goran Stevanović",
        "demo-guest-25",
        25,
        "@gorans",
        ["Riverside studio"],
    ),
    # ── 31-60 days ago — the previous 30-day window. ──────────────────
    BookingTemplate(
        _booking_id(26),
        SLOT_Y8,
        False,
        1,
        "Milica Radović",
        "demo-guest-26",
        32,
        "@milicar",
        ["Downtown studio"],
    ),
    BookingTemplate(
        _booking_id(27),
        SLOT_B6,
        False,
        1,
        "Radovan Knežević",
        "demo-guest-27",
        34,
        "@radovank",
        None,
    ),
    BookingTemplate(
        _booking_id(28),
        SLOT_P5,
        False,
        1,
        "Sofija Marić",
        "demo-guest-28",
        36,
        "@sofijam",
        ["Take-home glaze kit"],
    ),
    BookingTemplate(
        _booking_id(29),
        SLOT_Y7,
        False,
        1,
        "Todor Jovanović",
        "demo-guest-29",
        38,
        "@todorj",
        ["Downtown studio"],
    ),
    BookingTemplate(
        _booking_id(30),
        SLOT_B5,
        False,
        1,
        "Anastasija Milošević",
        "demo-guest-30",
        40,
        "@anastasijam",
        None,
    ),
    BookingTemplate(
        _booking_id(31),
        SLOT_Y6,
        False,
        2,
        "Lazar Gagić",
        "demo-guest-31",
        42,
        "@lazarg",
        ["Riverside studio"],
    ),
    BookingTemplate(
        _booking_id(32),
        SLOT_P4,
        False,
        1,
        "Vesna Protić",
        "demo-guest-32",
        44,
        "@vesnap",
        ["Photo of your piece"],
    ),
    BookingTemplate(
        _booking_id(33), SLOT_B3, False, 1, "Bojan Janković", "demo-guest-33", 46, "@bojanj", None
    ),
    BookingTemplate(
        _booking_id(34),
        SLOT_Y5,
        False,
        1,
        "Ivana Dragović",
        "demo-guest-34",
        48,
        "@ivanad",
        ["Downtown studio"],
    ),
    BookingTemplate(
        _booking_id(35), SLOT_B6, True, 1, "Miloš Arsić", "demo-guest-35", 50, "@milosa", None
    ),
    BookingTemplate(
        _booking_id(36),
        SLOT_P5,
        False,
        2,
        "Jelena Cvetanović",
        "demo-guest-36",
        52,
        "@jelenac",
        ["Bring a friend (+1 seat)"],
    ),
    BookingTemplate(
        _booking_id(37),
        SLOT_Y8,
        False,
        1,
        "Nemanja Kostić",
        "demo-guest-37",
        54,
        "@nemanjak",
        ["Riverside studio"],
    ),
    BookingTemplate(
        _booking_id(38), SLOT_B3, False, 1, "Milica Zorić", "demo-guest-38", 56, "@milicaz", None
    ),
    BookingTemplate(
        _booking_id(39),
        SLOT_Y7,
        False,
        1,
        "Aleksa Mitrović",
        "demo-guest-39",
        58,
        "@aleksam",
        ["Downtown studio"],
    ),
    BookingTemplate(
        _booking_id(40),
        SLOT_P4,
        False,
        1,
        "Tamara Bogdanović",
        "demo-guest-40",
        60,
        "@tamarab",
        ["Take-home glaze kit"],
    ),
]


def build_demo_slots(now: datetime) -> list[dict[str, Any]]:
    """Resolve the templates against now, as insert-ready dicts.
    booked_count is a plain number, not derived from booking rows: the
    demo shows realistic fill levels without a booking per seat, and
    the read-only account means the counters never drift."""
    out: list[dict[str, Any]] = []
    for t in DEMO_SLOT_TEMPLATES:
        starts_at = datetime(
            now.year, now.month, now.day, t.hour, 0, 0, 0, tzinfo=now.tzinfo
        ) + timedelta(days=t.day_offset + 1)
        out.append(
            {
                "id": t.id,
                "service_id": t.service_id,
                "starts_at": starts_at,
                "duration_minutes": t.duration_minutes,
                "capacity": t.capacity,
                "booked_count": t.booked_count,
                "price": t.price,
            }
        )
    return out


def build_demo_bookings(now: datetime, slots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Resolve the templates against now and the built slots, as
    insert-ready dicts. Tokens are random per run; every row carries
    manage_token_expires_at = slot start + 24h (the production rule):
    past-slot bookings are born expired, upcoming usable — no row
    recreates the NULL-expiry state migration 0014 removed."""
    starts_at = {s["id"]: s["starts_at"] for s in slots}
    out: list[dict[str, Any]] = []
    for t in DEMO_BOOKING_TEMPLATES:
        expires_at = now + MANAGE_TOKEN_GRACE_PERIOD
        if t.time_slot_id in starts_at:
            expires_at = starts_at[t.time_slot_id] + MANAGE_TOKEN_GRACE_PERIOD
        token = new_manage_token()
        out.append(
            {
                "id": t.id,
                "time_slot_id": t.time_slot_id,
                "status": "cancelled" if t.cancelled else "confirmed",
                "seats": t.seats,
                "guest_name": t.guest_name,
                "guest_messenger": "telegram",
                "guest_messenger_id": t.guest_messenger_id,
                "guest_messenger_login": t.guest_login,
                "guest_locale": DEFAULT_LOCALE,
                "manage_token": token,
                "manage_token_hash": hash_manage_token(token),
                "selected_options": t.selected_options,
                "created_at": now - timedelta(days=t.days_ago),
                "manage_token_expires_at": expires_at,
            }
        )
    return out


async def seed_demo(now: datetime) -> None:
    """Seed / refresh the read-only demo organizer. Idempotent — runs on
    the QStash schedule so demo slots stay in the future. Upserts
    organizer and services by deterministic ids, then replaces slots
    and bookings wholesale."""
    slots = build_demo_slots(now)
    slot_bookings = build_demo_bookings(now, slots)
    demo_service_ids = [s.id for s in DEMO_SERVICES]

    # Local import: repositories pull sqlalchemy + models; tests import
    # seed.py on the fast path, so they stay lazy here.
    from ..repositories import booking_repo, organizer_repo, service_repo, slot_repo

    async with sessionmaker()() as session, session.begin():
        # The seed outruns the request-oriented statement_timeout on
        # every connection (ADR-024), so the tx widens it for itself —
        # SET LOCAL ends with the transaction.
        from sqlalchemy import text as _text

        await session.execute(_text("SET LOCAL statement_timeout = '60s'"))
        await organizer_repo.upsert_demo_organizer(
            session,
            id=DEMO_ORGANIZER_ID,
            slug=DEMO_ORGANIZER_SLUG,
            name="Studio Demo",
            messenger_id=DEMO_MESSENGER_ID,
            timezone=DEMO_TIMEZONE,
            language=DEFAULT_LOCALE,
            description=DEMO_ORGANIZER_DESCRIPTION,
            photo_url=DEMO_ORGANIZER_PHOTO_URL,
            location=DEMO_ORGANIZER_LOCATION,
            contact=DEMO_ORGANIZER_CONTACT,
        )

        for s in DEMO_SERVICES:
            await service_repo.upsert_demo_service(
                session,
                {
                    "id": s.id,
                    "organizer_id": DEMO_ORGANIZER_ID,
                    "title": s.title,
                    "description": s.description,
                    "photo_url": s.photo_url,
                    "location": s.location,
                    "contact": s.contact,
                    "default_price": s.default_price,
                    "default_capacity": s.default_capacity,
                    "default_duration_minutes": s.default_duration_minutes,
                    "max_seats_per_booking": s.max_seats_per_booking,
                    "options": s.options,
                    "options_select_mode": s.options_select_mode,
                },
            )

        # Replace slots (and their bookings) wholesale.
        await booking_repo.delete_bookings_for_services(session, demo_service_ids)
        await slot_repo.delete_slots_for_services(session, demo_service_ids)

        await slot_repo.insert_slots(session, slots)
        await booking_repo.insert_bookings(session, slot_bookings)


if __name__ == "__main__":
    # CLI entry: `PYTHONPATH=api/_lib uv run python -m countmein.db.seed`
    # (run from apps/web). The only copy of the demo seed (ADR-021) —
    # `bun run db:seed:demo` delegates here. Loads the repo-root .env when
    # present (local dev); CI sets connection vars via `env:` instead, so a
    # missing file is fine and never overrides the environment.
    import asyncio
    from datetime import UTC
    from pathlib import Path

    from dotenv import load_dotenv

    _env_file = next(
        (p / ".env" for p in Path(__file__).resolve().parents if (p / ".env").is_file()),
        None,
    )
    if _env_file is not None:
        load_dotenv(_env_file, override=False)

    asyncio.run(seed_demo(datetime.now(tz=UTC)))
    print("[seed] demo organizer seeded — https://countmein.group/demo")
