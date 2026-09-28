"""The SQL strategy is raw text() with hand-maintained column lists
(ADR-021): db/tables.py was deleted — packages/db owns
the schema, and the query layer pins its own column lists. This test
reflects the live Postgres and asserts every column the constants and
the chain-SELECT projections mention exists, so a schema drift breaks
loudly here instead of as a runtime SQL error. Requires POSTGRES_URL —
skipped locally without it, failed in CI.
"""

from __future__ import annotations

import pytest
from countmein.db.client import engine
from countmein.db.rows import (
    BOOKING_CHAIN_SELECT,
    BOOKING_COLUMNS,
    ORGANIZER_COLUMNS,
    SERVICE_COLUMNS,
    SLOT_CHAIN_SELECT,
    SLOT_COLUMNS,
)
from sqlalchemy import text

# Every test needs the live Postgres (schema introspection) — the whole
# module is integration.
pytestmark = pytest.mark.integration

# table → the column-list constant the query layer uses.
TABLE_COLUMNS = {
    "bookings": BOOKING_COLUMNS,
    "time_slots": SLOT_COLUMNS,
    "services": SERVICE_COLUMNS,
    "organizers": ORGANIZER_COLUMNS,
}

ENUMS = {
    "options_select_mode": {"single", "multi"},
    "booking_status": {"confirmed", "cancelled"},
    "messenger_kind": {"telegram"},
    "outbox_status": {"pending", "sent", "failed", "skipped"},
}


def require_postgres() -> None:
    from _env import require_postgres as _require

    _require()


def _column_names(column_list: str) -> set[str]:
    """The constant is a projection list: split on commas and strip the
    ::text casts and array_to_json() wrappers the mappers rely on."""
    names: set[str] = set()
    for part in column_list.split(","):
        part = part.strip()
        if "::" in part:
            part = part.split("::", 1)[0]
        if part.startswith("array_to_json("):
            part = part[len("array_to_json(") : -1]
        names.add(part)
    return names


# The chain SELECTs project the same columns, prefixed by table alias;
# the alias maps each projected column back to its table for the check.
CHAIN_SELECTS = {
    "SLOT_CHAIN_SELECT": (
        SLOT_CHAIN_SELECT,
        {"ts": "time_slots", "s": "services", "o": "organizers"},
    ),
    "BOOKING_CHAIN_SELECT": (
        BOOKING_CHAIN_SELECT,
        {"b": "bookings", "ts": "time_slots", "s": "services", "o": "organizers"},
    ),
}


async def test_column_lists_match_schema():
    require_postgres()
    async with engine().connect() as conn:
        for table, column_list in TABLE_COLUMNS.items():
            rows = await conn.execute(
                text("SELECT column_name FROM information_schema.columns WHERE table_name = :t"),
                {"t": table},
            )
            live = {r[0] for r in rows.fetchall()}
            assert live, f"table {table} missing from live schema"
            used = _column_names(column_list)
            assert used <= live, (
                f"{table}: query-layer columns missing from live schema: {sorted(used - live)}"
            )


async def test_chain_selects_match_schema():
    """The chain SELECTs are hand-maintained like the column constants —
    every projected column must name a real column of its table
    (matched via the alias prefix)."""
    require_postgres()
    async with engine().connect() as conn:
        for name, (sql, aliases) in CHAIN_SELECTS.items():
            projection = sql.split("FROM", 1)[0].strip()
            body = projection[len("SELECT") :].strip()
            for part in body.split(","):
                part = part.strip()
                if not part:
                    continue
                # Unwrap array_to_json(alias.col) before splitting on the
                # alias dot — the wrapper's own dot is not the separator.
                wrapped = part.startswith("array_to_json(") and part.endswith(")")
                inner = part[len("array_to_json(") : -1] if wrapped else part
                alias, _, column = inner.partition(".")
                assert column, f"{name}: unprefixed projection item {part!r}"
                assert alias in aliases, f"{name}: unknown alias {alias!r}"
                if "::" in column:
                    column = column.split("::", 1)[0]
                table = aliases[alias]
                rows = await conn.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns WHERE table_name = :t"
                    ),
                    {"t": table},
                )
                live = {r[0] for r in rows.fetchall()}
                assert column in live, f"{name}/{table}: no such column {column!r}"


async def test_enums_match_schema():
    require_postgres()
    async with engine().connect() as conn:
        for enum_name, expected in ENUMS.items():
            rows = await conn.execute(
                text(
                    "SELECT e.enumlabel FROM pg_enum e "
                    "JOIN pg_type t ON t.oid = e.enumtypid "
                    "WHERE t.typname = :name ORDER BY e.oid"
                ),
                {"name": enum_name},
            )
            live = {r[0] for r in rows.fetchall()}
            assert live, f"enum {enum_name} missing in live schema"
            assert live == expected, (
                f"enum {enum_name}: expected {sorted(expected)} vs live {sorted(live)}"
            )
