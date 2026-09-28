"""The rendering side of every notification template. Telegram parses
these strings as HTML — an unescaped & or < in a guest name is a 400
"can't parse entities" and the message is never delivered. Locale
selection (ADR-011) and the organizer-timezone rule are contracts, not
preferences: the guest's confirmation must show the same wall clock as
the public page they booked from.

The golden files (tests_py/jobs/testdata/notifications/*.golden) were
recorded from the retired Go implementation — the port must render them
byte for byte."""

import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from countmein.contracts import domain
from countmein.db.rows import BookingRow, OrganizerRow, ServiceRow, TimeSlotRow
from countmein.i18n.loader import notif
from countmein.jobs import templates
from countmein.jobs.templates import (
    BookingView,
    booking_cancelled_for_guest,
    booking_cancelled_for_organizer,
    booking_created_for_guest,
    booking_created_for_organizer,
    booking_lines,
    escape_html,
    format_instant,
    notification_locale,
    organizer_detail_lines,
)

GOLDEN_DIR = Path(__file__).resolve().parent / "testdata" / "notifications"

UPDATE_GOLDENS = "--update-goldens" in sys.argv


def make_test_view() -> BookingView:
    """A BookingView with every user-supplied field populated: names,
    titles, option labels, prices, location and contact all come from
    guest/organizer input and must survive escaping."""
    return BookingView(
        booking=BookingRow(
            id="01930000-0000-7000-8000-0000000000b1",
            time_slot_id="01930000-0000-7000-8000-0000000000s1",
            status="confirmed",
            seats=2,
            guest_name='Anne & Co <"anne">',
            guest_messenger="telegram",
            guest_messenger_id="7001",
            guest_messenger_login="@anne",
            guest_locale="ru",
            manage_token="tok-abc123",
            manage_token_hash="hash",
            selected_options=["Mat rental", "Towel +2€"],
        ),
        slot=TimeSlotRow(
            id="01930000-0000-7000-8000-0000000000s1",
            service_id="01930000-0000-7000-8000-0000000000v1",
            starts_at=datetime(2026, 7, 25, 7, 0, 0, tzinfo=ZoneInfo("Europe/Belgrade")),
            duration_minutes=60,
            capacity=10,
            booked_count=7,
            price="15 EUR",
        ),
        service=ServiceRow(
            id="01930000-0000-7000-8000-0000000000v1",
            organizer_id="01930000-0000-7000-8000-0000000000o1",
            title="Yoga <Morning> Flow",
            default_price="12 EUR",
            default_capacity=10,
            default_duration_minutes=60,
            max_seats_per_booking=4,
            location="Studio 5 <Main Hall>",
            contact="+381 60 123 4567",
        ),
        organizer=OrganizerRow(
            id="01930000-0000-7000-8000-0000000000o1",
            slug="test-org",
            name="Mira & Yoga",
            messenger="telegram",
            messenger_id="6001",
            timezone="Europe/Belgrade",
            language="de",
        ),
    )


# ── escape_html ───────────────────────────────────────────────────────────────


# Expected values are composed from parts because literal HTML entities
# in this source get mangled by the authoring pipeline (the same reason
# templates.py builds them from parts).
_AMP = "&" + "amp;"
_LT = "&" + "lt;"
_GT = "&" + "gt;"
_QUOT = "&" + "quot;"
_APOS = "&" + "#" + "39;"


@pytest.mark.parametrize(
    "in_text,want",
    [
        ("<Anne & Co>", _LT + "Anne " + _AMP + " Co" + _GT),
        ("'; DROP TABLE bookings; --", _APOS + "; DROP TABLE bookings; --"),
        ('she said "ok"', "she said " + _QUOT + "ok" + _QUOT),
        ("plain text", "plain text"),
        ("emoji 🔑 stays", "emoji 🔑 stays"),
        ("<b>bold</b>", _LT + "b" + _GT + "bold" + _LT + "/b" + _GT),
    ],
)
def test_escape_html(in_text, want):
    assert escape_html(in_text) == want


def test_rendered_messages_escape_user_input():
    """The regression behind this test: a guest called "Anne & Co" used
    to break Telegram's entity parser. Every user-supplied value in a
    rendered message must go through escape_html — this pins the
    composed output, not just the helper."""
    view = make_test_view()
    messages = {
        "createdOrganizer": booking_created_for_organizer(
            view, "https://example.com/cabinet", "en"
        ),
        "createdGuest": booking_created_for_guest(view, "https://example.com/booking/tok", "en"),
        "cancelledOrganizer": booking_cancelled_for_organizer(
            view, "https://example.com/cabinet", "en"
        ),
        "cancelledGuest": booking_cancelled_for_guest(view, "https://example.com/org", "en"),
    }
    for name, msg in messages.items():
        assert "& Co" not in msg.text, f"{name}: message contains unescaped user input"
        assert "<anne>" not in msg.text, f"{name}: message contains unescaped user input"
    # The two organizer-facing messages lead with the guest; the escaped
    # form must appear there.
    escaped_name = "Anne " + _AMP + " Co"
    for name in ("createdOrganizer", "cancelledOrganizer"):
        assert escaped_name in messages[name].text, f"{name}: must carry the escaped guest name"


# ── notification_locale (ADR-011) ─────────────────────────────────────────────


def test_notification_locale():
    view = make_test_view()  # organizer.language = "de", booking.guest_locale = "ru"

    assert notification_locale("organizer", view) == "de"
    assert notification_locale("guest", view) == "ru"

    # Free-text columns must not break rendering — garbage clamps to en.
    view.organizer.language = "klingon"
    assert notification_locale("organizer", view) == domain.DEFAULT_LOCALE
    view.booking.guest_locale = ""
    assert notification_locale("guest", view) == domain.DEFAULT_LOCALE


# ── format_instant: organizer's timezone, locale labels ───────────────────────


def test_format_instant_always_in_organizer_timezone():
    instant = datetime(2026, 7, 25, 7, 0, 0, tzinfo=ZoneInfo("Europe/Belgrade"))  # 05:00 UTC

    en = format_instant(instant, "Europe/Belgrade", "en")
    ru = format_instant(instant, "Europe/Belgrade", "ru")
    assert "07:00" in en and "07:00" in ru, (
        f"wall clock must be Belgrade 07:00 in every locale, got en={en!r} ru={ru!r}"
    )
    assert en != ru, f"labels must differ per locale, both rendered {en!r}"

    # The zone is the organizer's, never the recipient's: rendering with
    # a different zone would change the printed time.
    la = format_instant(instant, "America/Los_Angeles", "en")
    assert "07:00" not in la, f"LA rendering must show LA wall clock, got {la!r}"

    # An unknown timezone falls back to UTC, not to a panic.
    assert format_instant(instant, "Mars/Olympus", "en") != ""
    # An unknown locale falls back to the default calendar.
    got = format_instant(instant, "Europe/Belgrade", "xx")
    assert "07:00" in got, (
        f"unknown locale must fall back to {domain.DEFAULT_LOCALE!r}, got {got!r}"
    )


# ── booking_lines: price precedence and option/empty sections ─────────────────


def test_booking_lines_price_precedence():
    # Slot override wins over the service default.
    view = make_test_view()  # slot price "15 EUR", service default "12 EUR"
    lines = booking_lines(view, "en")
    assert "💰 15 EUR" in lines, f"slot price override must win, got {lines}"

    # No override → the service default.
    view.slot.price = None
    lines = booking_lines(view, "en")
    assert "💰 12 EUR" in lines, f"service default price must render, got {lines}"

    # Both empty → no price line at all.
    view.service.default_price = ""
    lines = booking_lines(view, "en")
    assert not any(line.startswith("💰") for line in lines), (
        f"empty price must hide the section, got {lines}"
    )


def test_booking_lines_options_and_seats():
    view = make_test_view()
    lines = booking_lines(view, "en")
    assert "🔖 Mat rental, Towel +2€" in lines, f"selected options must render joined, got {lines}"
    # The seats line is ICU-pluralized per locale; pin that it exists and
    # carries the count.
    assert "2" in "\n".join(lines), f"seats count must appear in the lines, got {lines!r}"

    # No options → the section is hidden.
    view.booking.selected_options = None
    lines = booking_lines(view, "en")
    assert not any(line.startswith("🔖") for line in lines), (
        f"empty options must hide the section, got {lines}"
    )


# ── organizer_detail_lines: service-over-organizer (docs/domain.md) ───────────


def test_organizer_detail_lines_override():
    view = make_test_view()
    lines = organizer_detail_lines(view)
    joined = "\n".join(lines)
    want_loc = "Studio 5 " + _LT + "Main Hall" + _GT
    assert want_loc in joined, f"service location must win (and be escaped), got {lines}"

    # No service values → the organizer's own.
    view.service.location = None
    view.service.contact = None
    view.organizer.location = "Belgrade, Dorćol"
    view.organizer.contact = "@mira_yoga"
    lines = organizer_detail_lines(view)
    assert "📍 Belgrade, Dorćol" in lines and "☎️ @mira_yoga" in lines, (
        f"organizer fallback must render, got {lines}"
    )

    # Both empty → no lines at all.
    view.organizer.location = None
    view.organizer.contact = None
    assert organizer_detail_lines(view) == []


# ── full vs stillFree ─────────────────────────────────────────────────────────


def test_booking_created_for_organizer_full_vs_still_free():
    view = make_test_view()  # capacity 10, booked 7 → 3 left
    msg = booking_created_for_organizer(view, "https://example.com/cabinet", "en")
    assert "3" in msg.text, f"stillFree must carry the remaining count, got:\n{msg.text}"

    view.slot.booked_count = 10  # full
    msg = booking_created_for_organizer(view, "https://example.com/cabinet", "en")
    full = notif("en", "createdOrganizer", "full")
    assert full and full in msg.text, (
        f"sold-out slot must render the full message, got:\n{msg.text}"
    )
    assert notif("en", "createdOrganizer", "stillFree", {"count": 0}) not in msg.text, (
        f"full slot must not render stillFree, got:\n{msg.text}"
    )


def test_message_buttons_carry_urls():
    view = make_test_view()
    msg = booking_created_for_organizer(view, "https://example.com/cabinet", "en")
    assert msg.button is not None and msg.button.url == "https://example.com/cabinet"
    msg = booking_created_for_guest(view, "https://example.com/booking/tok", "en")
    assert msg.button is not None and msg.button.url == "https://example.com/booking/tok"


# ── golden files: 8 locales × 4 templates ─────────────────────────────────────


def _render_message(m: templates.Message) -> str:
    out = m.text
    if m.button is not None:
        out += "\n[button] " + m.button.text + " → " + m.button.url
    return out


@pytest.mark.parametrize("locale", domain.LOCALES)
def test_golden_notifications(locale):
    """Every notification template renders a golden per locale — a change
    to copy, escaping, section order or plural handling in ANY locale
    shows up as a diff. The goldens are shared with the Go package, so
    the two implementations are pinned to identical output."""
    view = make_test_view()
    got = "\n".join(
        [
            "## createdOrganizer",
            _render_message(
                booking_created_for_organizer(view, "https://example.com/cabinet", locale)
            ),
            "## createdGuest",
            _render_message(
                booking_created_for_guest(view, "https://example.com/booking/tok-abc123", locale)
            ),
            "## cancelledOrganizer",
            _render_message(
                booking_cancelled_for_organizer(view, "https://example.com/cabinet", locale)
            ),
            "## cancelledGuest",
            _render_message(
                booking_cancelled_for_guest(view, "https://example.com/test-org", locale)
            ),
        ]
    )

    path = GOLDEN_DIR / f"{locale}.golden"
    if UPDATE_GOLDENS:
        path.write_text(got)
        return
    want = path.read_text()
    assert want == got, (
        f"notification output for {locale!r} changed; diff the golden file {path} "
        "(or regenerate with --update-goldens)"
    )
