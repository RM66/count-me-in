"""The rendering side of every notification, as Telegram HTML.

Language (ADR-011): every message renders in one of the app locales —
the organizer reads their own organizers.language, the guest the
guestLocale captured at booking time, both clamped to the supported set
(free-text columns must not break rendering).

Times always render in the organizer's timezone, for the guest too: a
slot is authored as a wall-clock reading in that zone and it is the one
printed on the public page the guest booked from; re-rendering in
another zone would make the confirmation disagree with the page. Only
the labels follow the locale, never the zone.

HTML tags live here in code, not in the ICU messages: use-intl reads
<tag> pairs as rich-text placeholders, the wrong tool for Telegram HTML.
Only user-supplied values are escaped — tags composed here are trusted
markup."""

from __future__ import annotations

import zoneinfo
from dataclasses import dataclass
from datetime import datetime

from ..contracts import domain
from ..db.rows import BookingRow, OrganizerRow, ServiceRow, TimeSlotRow
from ..i18n.loader import notif
from .telegram import MessageButton


@dataclass(frozen=True)
class Message:
    """A rendered notification."""

    text: str
    button: MessageButton | None = None


@dataclass(frozen=True)
class BookingView:
    """The raw rows a notification needs (two read models over one
    chain: this one keeps manageToken, chat ids and timezones)."""

    booking: BookingRow
    slot: TimeSlotRow
    service: ServiceRow
    organizer: OrganizerRow


def escape_html(value: str) -> str:
    """Escape the five characters that would otherwise be read as
    markup. Every interpolated value goes through this: guest names,
    titles and option labels are user input, and an unescaped < turns
    the whole message into a 400 can't parse entities — a delivery
    failure caused by a guest called "Anne & Co"."""
    return (
        value.replace("&", "&" + "amp;")
        .replace("<", "&" + "lt;")
        .replace(">", "&" + "gt;")
        .replace('"', "&" + "quot;")
        .replace("'", "&" + "#" + "39;")
    )


def notification_locale(recipient: str, view: BookingView) -> str:
    """The locale a recipient reads: the organizer's own language, the
    guest's captured booking locale."""
    stored = view.booking.guest_locale
    if recipient == "organizer":
        stored = view.organizer.language
    if domain.is_app_locale(stored):
        return stored
    return domain.DEFAULT_LOCALE


# Per-locale short weekday and month names for format_instant —
# these cover the app's eight
# locales (approximate ICU shapes; message text only, not a wire
# contract). Ported verbatim so the golden files match byte for byte.
_CALENDARS: dict[str, tuple[tuple[str, ...], tuple[str, ...], str]] = {
    "en": (
        ("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"),
        ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"),
        "{wd}, {mo} {d}, {y}, {hh}:{mm}",
    ),
    "de": (
        ("So.", "Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa."),
        (
            "Jan.",
            "Feb.",
            "März",
            "Apr.",
            "Mai",
            "Juni",
            "Juli",
            "Aug.",
            "Sept.",
            "Okt.",
            "Nov.",
            "Dez.",
        ),
        "{wd}, {d}. {mo} {y}, {hh}:{mm}",
    ),
    "es": (
        ("dom.", "lun.", "mar.", "mié.", "jue.", "vie.", "sáb."),
        (
            "ene.",
            "feb.",
            "mar.",
            "abr.",
            "may.",
            "jun.",
            "jul.",
            "ago.",
            "sept.",
            "oct.",
            "nov.",
            "dic.",
        ),
        "{wd}, {d} {mo} {y}, {hh}:{mm}",
    ),
    "fr": (
        ("dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."),
        (
            "janv.",
            "févr.",
            "mars",
            "avr.",
            "mai",
            "juin",
            "juil.",
            "août",
            "sept.",
            "oct.",
            "nov.",
            "déc.",
        ),
        "{wd} {d} {mo} {y}, {hh}:{mm}",
    ),
    "pt": (
        ("dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."),
        (
            "jan.",
            "fev.",
            "mar.",
            "abr.",
            "mai.",
            "jun.",
            "jul.",
            "ago.",
            "set.",
            "out.",
            "nov.",
            "dez.",
        ),
        "{wd}, {d} de {mo} de {y}, {hh}:{mm}",
    ),
    "ru": (
        ("вс", "пн", "вт", "ср", "чт", "пт", "сб"),
        (
            "янв.",
            "февр.",
            "мар.",
            "апр.",
            "мая",
            "июн.",
            "июл.",
            "авг.",
            "сент.",
            "окт.",
            "нояб.",
            "дек.",
        ),
        "{wd}, {d} {mo} {y} г., {hh}:{mm}",
    ),
    "ar": (
        ("أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"),
        (
            "يناير",
            "فبراير",
            "مارس",
            "أبريل",
            "مايو",
            "يونيو",
            "يوليو",
            "أغسطس",
            "سبتمبر",
            "أكتوبر",
            "نوفمبر",
            "ديسمبر",
        ),
        "{wd}، {d} {mo} {y}، {hh}:{mm}",
    ),
    "ja": (
        ("日", "月", "火", "水", "木", "金", "土"),
        ("1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"),
        "{y}/{mo}/{d}({wd}) {hh}:{mm}",
    ),
}


def _pad2(v: int) -> str:
    s = str(v)
    return "0" + s if len(s) < 2 else s


def format_instant(t: datetime, timezone: str, locale: str) -> str:
    """Render a slot start as read in `timezone`, labels in `locale`
    ("Sat, 25 Jul 2026, 07:00"-shaped, per-locale)."""
    calendar = _CALENDARS.get(locale) or _CALENDARS[domain.DEFAULT_LOCALE]
    weekdays, months, pattern = calendar
    try:
        loc = zoneinfo.ZoneInfo(timezone)
    except (ValueError, KeyError, OSError):
        loc = zoneinfo.ZoneInfo("UTC")
    tt = t.astimezone(loc)
    # Python: Monday=0..Sunday=6; the tables are Sunday-first.
    wd = (tt.weekday() + 1) % 7
    out = pattern
    out = out.replace("{wd}", weekdays[wd])
    out = out.replace("{mo}", months[tt.month - 1])
    out = out.replace("{d}", str(tt.day))
    out = out.replace("{y}", str(tt.year))
    out = out.replace("{hh}", _pad2(tt.hour))
    out = out.replace("{mm}", _pad2(tt.minute))
    return out


def booking_lines(view: BookingView, locale: str) -> list[str]:
    """What, when, how many: the lines both audiences need, shared so a
    change to how a booking is described cannot land in the guest's
    message and be forgotten in the organizer's."""
    lines = [
        "📌 <b>" + escape_html(view.service.title) + "</b>",
        "🗓 " + escape_html(format_instant(view.slot.starts_at, view.organizer.timezone, locale)),
        "👥 " + notif(locale, "", "seats", {"count": view.booking.seats}),
    ]
    if view.booking.selected_options:
        lines.append("🔖 " + escape_html(", ".join(view.booking.selected_options)))
    price = domain.slot_price(view.slot.price, view.service.default_price)
    if price != "":
        lines.append("💰 " + escape_html(price))
    return lines


def guest_contact_line(view: BookingView) -> str:
    """How the organizer can reach the guest, when Telegram exposes a
    handle."""
    if view.booking.guest_messenger_login is not None:
        return (
            "👤 "
            + escape_html(view.booking.guest_name)
            + " ("
            + escape_html(view.booking.guest_messenger_login)
            + ")"
        )
    return "👤 " + escape_html(view.booking.guest_name)


def organizer_detail_lines(view: BookingView) -> list[str]:
    """Where and how to reach the organizer; service value wins
    (docs/domain.md)."""
    lines: list[str] = []
    location = domain.effective_location(view.service.location, view.organizer.location)
    if location is not None:
        lines.append("📍 " + escape_html(location))
    contact = domain.effective_contact(view.service.contact, view.organizer.contact)
    if contact is not None:
        lines.append("☎️ " + escape_html(contact))
    return lines


def _join_lines(*parts: str) -> str:
    return "\n".join(parts)


def booking_created_for_organizer(view: BookingView, cabinet_url: str, locale: str) -> Message:
    """To the organizer: someone just booked. Leads with the guest
    because that is the new information; the remaining-seats line makes
    the message worth reading at a glance."""

    def t(key: str, params: dict | None = None) -> str:  # type: ignore[type-arg]
        return notif(locale, "createdOrganizer", key, params)

    left = domain.seats_left(view.slot.capacity, view.slot.booked_count)
    tail = t("full") if left == 0 else t("stillFree", {"count": left})
    text = _join_lines(
        "🎉 <b>" + t("title") + "</b>",
        "",
        guest_contact_line(view),
        _join_lines(*booking_lines(view, locale)),
        "",
        tail,
    )
    return Message(text=text, button=MessageButton(text=t("button"), url=cabinet_url))


def booking_created_for_guest(view: BookingView, manage_url: str, locale: str) -> Message:
    """Your booking is confirmed, and here is how to manage it."""

    def t(key: str, params: dict | None = None) -> str:  # type: ignore[type-arg]
        return notif(locale, "createdGuest", key, params)

    text = _join_lines(
        "✅ <b>" + t("title") + "</b> " + t("withName", {"name": escape_html(view.organizer.name)}),
        "",
        _join_lines(*booking_lines(view, locale)),
        _join_lines(*organizer_detail_lines(view)),
        "",
        t("footer"),
    )
    return Message(text=text, button=MessageButton(text=t("button"), url=manage_url))


def booking_cancelled_for_organizer(view: BookingView, cabinet_url: str, locale: str) -> Message:
    """The guest cancelled, the seats are back."""

    def t(key: str, params: dict | None = None) -> str:  # type: ignore[type-arg]
        return notif(locale, "cancelledOrganizer", key, params)

    text = _join_lines(
        "❌ <b>" + t("title") + "</b>",
        "",
        guest_contact_line(view),
        _join_lines(*booking_lines(view, locale)),
        "",
        t("freed", {"count": domain.seats_left(view.slot.capacity, view.slot.booked_count)}),
    )
    return Message(text=text, button=MessageButton(text=t("button"), url=cabinet_url))


def booking_cancelled_for_guest(view: BookingView, organizer_url: str, locale: str) -> Message:
    """The organizer cancelled your booking. Carries the organizer's
    contact and a link back to their page: the guest did not choose
    this, so the message's job is to explain and offer the next step. No
    management link — the booking is cancelled."""

    def t(key: str, params: dict | None = None) -> str:  # type: ignore[type-arg]
        return notif(locale, "cancelledGuest", key, params)

    text = _join_lines(
        "❌ <b>" + t("title") + "</b> " + t("byName", {"name": escape_html(view.organizer.name)}),
        "",
        _join_lines(*booking_lines(view, locale)),
        _join_lines(*organizer_detail_lines(view)),
        "",
        t("footer"),
    )
    return Message(text=text, button=MessageButton(text=t("button"), url=organizer_url))
