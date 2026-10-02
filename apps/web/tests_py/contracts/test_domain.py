"""Run the shared domain
vectors in packages/contracts/vectors/domain (the same corpus vitest
runs on the TS side)."""

import json
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from countmein.contracts import domain
from countmein.db.serializers import can_cancel_booking
from countmein.db.shared import hash_manage_token

VECTORS_DIR = Path(__file__).resolve().parents[4] / "packages" / "contracts" / "vectors" / "domain"

# `$now±N{unit}` markers keep time-dependent vectors evergreen; the TS
# side expands the same markers in test-helpers.ts (expandNowMarkers).
_NOW_MARK = re.compile(r"^\$now([+-]\d+)(s|m|h|d)$")
_UNIT_SECONDS = {"s": 1, "m": 60, "h": 3600, "d": 86400}


def _expand_now(value):
    if isinstance(value, str):
        m = _NOW_MARK.match(value)
        if not m:
            return value
        instant = datetime.now(UTC) + timedelta(seconds=int(m.group(1)) * _UNIT_SECONDS[m.group(2)])
        return instant.isoformat().replace("+00:00", "Z")
    if isinstance(value, list):
        return [_expand_now(v) for v in value]
    if isinstance(value, dict):
        return {k: _expand_now(v) for k, v in value.items()}
    return value


def _to_utc(value: str | None) -> datetime | None:
    if value is None:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _load():
    assert VECTORS_DIR.is_dir(), f"vectors dir missing: {VECTORS_DIR}"
    for path in sorted(VECTORS_DIR.glob("*.json")):
        data = json.loads(path.read_text())
        for case in data["cases"]:
            yield pytest.param(data["fn"], case, id=f"{path.stem}/{case.get('name', '')}")


@pytest.mark.parametrize(("fn", "c"), list(_load()))
def test_domain_vectors(fn, c):
    if fn == "matchLocale":
        # The vector's input coerces null to ""; mirror that.
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
    elif fn == "hashManageToken":
        assert hash_manage_token(c["token"]) == c["expected"]
    elif fn == "canCancelBooking":
        case = _expand_now(c)
        booking = SimpleNamespace(
            status=case["status"],
            manage_token_expires_at=_to_utc(case.get("expiresAt")),
        )
        assert can_cancel_booking(booking) == c["expected"]
    else:
        pytest.fail(f"unknown domain fn {fn}")


def test_hash_manage_token_parity():
    """The lookup key is the same SHA-256 hex as the TS helper
    (@repo/contracts/manage-token). Dedicated named test so the
    invariant index (test_invariants.py) points at a real pin; the
    parametrized runner above also covers these cases."""
    data = json.loads((VECTORS_DIR / "hashManageToken.json").read_text())
    for c in data["cases"]:
        assert hash_manage_token(c["token"]) == c["expected"], f"hash mismatch: {c.get('name')}"


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


# (The cancel rule lives in db/rows.py can_cancel_booking — the
# manage-token-expiry semantics — and is pinned there; the dead
# slot-start-only variant was removed.)
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
    from countmein.contracts.payloads import AuthTicketPayload, LoginLinkPayload

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
