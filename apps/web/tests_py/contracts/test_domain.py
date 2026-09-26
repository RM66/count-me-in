"""Ported from pkg/contracts/vectors_test.go: run the shared domain
vectors in packages/contracts/vectors/domain (the same corpus vitest
runs on the TS side)."""

import json
from pathlib import Path

import pytest
from _lib.countmein.contracts import domain

VECTORS_DIR = Path(__file__).resolve().parents[4] / "packages" / "contracts" / "vectors" / "domain"


def _load():
    assert VECTORS_DIR.is_dir(), f"vectors dir missing: {VECTORS_DIR}"
    for path in sorted(VECTORS_DIR.glob("*.json")):
        data = json.loads(path.read_text())
        for case in data["cases"]:
            yield pytest.param(data["fn"], case, id=f"{path.stem}/{case.get('name', '')}")


@pytest.mark.parametrize(("fn", "c"), list(_load()))
def test_domain_vectors(fn, c):
    if fn == "matchLocale":
        # Go's c["input"].(string) coerces null to ""; mirror that.
        got = domain.match_locale(c["input"] or "")
        want = c.get("expected")
        want_ok = c["expected"] is not None
        assert (got, got is not None) == (want, want_ok)
    elif fn == "validateSelectedOptions":
        service_options = c.get("serviceOptions") or []
        # A null/absent mode must stay empty: the TS side passes null
        # through and skips the single-mode check, so defaulting to
        # "single" here would mask a regression in that branch.
        mode = c.get("selectMode") or ""
        selected = c.get("selected") or []
        want_valid = bool(c.get("valid"))
        try:
            got = domain.validate_selected_options(service_options, mode, selected)
            valid = True
        except ValueError:
            got = None
            valid = False
        assert valid == want_valid, f"{c.get('name')}: valid={valid}, want {want_valid}"
        if want_valid and "expectedSelected" in c:
            assert got == c["expectedSelected"]
    elif fn == "seatsLeft":
        assert domain.seats_left(int(c["capacity"]), int(c["bookedCount"])) == int(c["expected"])
    elif fn == "slotPrice":
        assert domain.slot_price(c.get("slotPrice"), c["serviceDefault"] or "") == c["expected"]
    elif fn == "effectiveLocation":
        assert domain.effective_location(c.get("service"), c.get("organizer")) == c.get("expected")
    elif fn == "effectiveContact":
        assert domain.effective_contact(c.get("service"), c.get("organizer")) == c.get("expected")
    elif fn == "cancelNotificationRecipient":
        assert domain.cancel_notification_recipient(c["cancelledBy"]) == c["expected"]
    elif fn == "loginLinkKey":
        assert domain.login_link_key(c["token"]) == c["expected"]
    elif fn == "isDemoOrganizerId":
        assert domain.is_demo_organizer_id(c.get("organizerId", "")) == c["expected"]
    else:
        pytest.fail(f"unknown domain fn {fn}")


def test_wall_clock_roundtrip():
    from datetime import UTC, datetime

    # Europe/Belgrade in September is UTC+2.
    instant = domain.wall_clock_to_instant("2026-09-13", "10:15", "Europe/Belgrade")
    assert instant == datetime(2026, 9, 13, 8, 15, tzinfo=UTC)
    date_str, time_str = domain.instant_to_wall_clock_inputs(instant, "Europe/Belgrade")
    assert (date_str, time_str) == ("2026-09-13", "10:15")


def test_slot_end():
    from datetime import UTC, datetime

    start = datetime(2026, 9, 13, 8, 15, tzinfo=UTC)
    assert domain.slot_end(start, 90) == datetime(2026, 9, 13, 9, 45, tzinfo=UTC)


def test_can_cancel_booking():
    from datetime import UTC, datetime, timedelta

    now = datetime(2026, 9, 13, 12, 0, tzinfo=UTC)
    future = now + timedelta(hours=1)
    past = now - timedelta(hours=1)
    assert domain.can_cancel_booking("confirmed", future, now)
    assert not domain.can_cancel_booking("confirmed", past, now)
    assert not domain.can_cancel_booking("cancelled", future, now)


def test_parse_flex_time():
    from datetime import UTC, datetime

    assert domain.parse_flex_time("2026-09-13T10:15:35Z") == datetime(
        2026, 9, 13, 10, 15, 35, tzinfo=UTC
    )
    assert domain.parse_flex_time(1_760_000_000) == datetime.fromtimestamp(1_760_000_000, tz=UTC)
    # > 1e12 → milliseconds
    assert domain.parse_flex_time(1_760_000_000_000) == datetime.fromtimestamp(
        1_760_000_000, tz=UTC
    )
    with pytest.raises(ValueError):
        domain.parse_flex_time("2026-09-13")  # date-only is local time in JS — rejected


def test_iso_date():
    from datetime import UTC, datetime

    t = datetime(2026, 9, 13, 10, 15, 35, 250000, tzinfo=UTC)
    assert domain.iso_date(t) == "2026-09-13T10:15:35.250Z"


def test_payloads_roundtrip():
    from _lib.countmein.contracts.payloads import AuthTicketPayload, LoginLinkPayload

    ticket = AuthTicketPayload(
        messenger="telegram",
        messenger_id="123",
        display_name="Ada",
        photo_url="https://x/y.png",
        purpose="guest",
    )
    assert AuthTicketPayload.from_json(ticket.to_json()) == ticket
    link = LoginLinkPayload(organizer_id="id", next="/cabinet")
    assert LoginLinkPayload.from_json(link.to_json()) == link
