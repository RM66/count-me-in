"""The positional scans are the fragile seam of the raw-SQL strategy:
the `*_COLUMNS` / `*_CHAIN_SELECT` projections and the `row[i]` indexes
are two hand-maintained lists that must agree in order — a reordered
column would silently swap fields, and the schema test only checks
existence, not order. This test pins the agreement without a database:
each projection expression becomes a sentinel value (its own column
name; array columns get a one-element list so parse_string_array passes
them through), the scan runs on the sentinel row, and every field must
carry the name of the column it was meant to read."""

from __future__ import annotations

import re

from countmein.db.rows import (
    BOOKING_CHAIN_SELECT,
    BOOKING_COLUMNS,
    ORGANIZER_COLUMNS,
    SERVICE_COLUMNS,
    SLOT_CHAIN_SELECT,
    SLOT_COLUMNS,
    scan_booking,
    scan_booking_chain,
    scan_organizer,
    scan_service,
    scan_slot,
    scan_slot_chain,
)

_ARRAY_RE = re.compile(r"^array_to_json\((.+)\)$")


def _sentinel_row(projection: str) -> list[object]:
    """One sentinel per column, in SELECT order: the column name as
    str; array_to_json projections get a one-element list so
    parse_string_array passes the value through unchanged. No nested
    commas exist in the projections, so a plain split is exact."""
    row: list[object] = []
    for expr in projection.split(","):
        expr = expr.strip()
        m = _ARRAY_RE.match(expr)
        if m:
            row.append([m.group(1)])
            continue
        row.append(re.sub(r"::\w+$", "", expr).strip())
    return row


def _chain_row(chain_select: str) -> list[object]:
    body = chain_select.split("SELECT", 1)[1].split("FROM", 1)[0]
    return _sentinel_row(body)


def test_column_constants_match_scan_order():
    # Each scan reads row[i] for the i-th column of its constant; the
    # sentinel row makes any disagreement (reordered column, shifted
    # index) visible as a wrong field value.
    organizer = scan_organizer(_sentinel_row(ORGANIZER_COLUMNS))
    assert organizer is not None
    assert organizer.slug == "slug"
    assert organizer.messenger == "messenger"
    assert organizer.timezone == "timezone"
    assert organizer.created_at == "created_at"

    service = scan_service(_sentinel_row(SERVICE_COLUMNS))
    assert service is not None
    assert service.organizer_id == "organizer_id"
    assert service.default_price == "default_price"
    assert service.options == ["options"]
    assert service.options_select_mode == "options_select_mode"
    assert service.created_at == "created_at"

    slot = scan_slot(_sentinel_row(SLOT_COLUMNS))
    assert slot is not None
    assert slot.service_id == "service_id"
    assert slot.booked_count == "booked_count"
    assert slot.price == "price"
    assert slot.created_at == "created_at"

    booking = scan_booking(_sentinel_row(BOOKING_COLUMNS))
    assert booking is not None
    assert booking.guest_messenger == "guest_messenger"
    assert booking.guest_messenger_login == "guest_messenger_login"
    assert booking.manage_token_hash == "manage_token_hash"
    assert booking.selected_options == ["selected_options"]
    assert booking.created_at == "created_at"
    assert booking.manage_token_expires_at == "manage_token_expires_at"


def test_slot_chain_select_matches_scan_order():
    chain = scan_slot_chain(_chain_row(SLOT_CHAIN_SELECT))
    assert chain is not None
    slot, service, organizer = chain
    assert slot.id == "ts.id"
    assert slot.booked_count == "ts.booked_count"
    assert service.id == "s.id"
    assert service.options == ["s.options"]
    assert service.options_select_mode == "s.options_select_mode"
    assert organizer.id == "o.id"
    assert organizer.messenger == "o.messenger"
    assert organizer.created_at == "o.created_at"


def test_booking_chain_select_matches_scan_order():
    chain = scan_booking_chain(_chain_row(BOOKING_CHAIN_SELECT))
    assert chain is not None
    booking, slot, service, organizer = chain
    assert booking.id == "b.id"
    assert booking.guest_messenger == "b.guest_messenger"
    assert booking.selected_options == ["b.selected_options"]
    assert booking.manage_token_expires_at == "b.manage_token_expires_at"
    assert slot.id == "ts.id"
    assert service.organizer_id == "s.organizer_id"
    assert organizer.timezone == "o.timezone"
