"""Port of the schema-match check: every column declared in
db/tables.py must match the migrated Postgres (packages/db owns the
schema; these declarations mirror it for query building). Requires
POSTGRES_URL — skipped locally without it, failed in CI.
"""

from __future__ import annotations

import os

import pytest
from _lib.countmein.db.client import engine
from _lib.countmein.db.tables import (
    booking_status_enum,
    messenger_kind_enum,
    options_select_mode_enum,
    outbox_status_enum,
)
from sqlalchemy import inspect, text

TABLES = ["organizers", "services", "time_slots", "bookings", "notification_outbox"]
ENUMS = {
    "options_select_mode": options_select_mode_enum,
    "booking_status": booking_status_enum,
    "messenger_kind": messenger_kind_enum,
    "outbox_status": outbox_status_enum,
}


def require_postgres() -> None:
    if os.getenv("POSTGRES_URL", "") == "":
        if os.getenv("CI") == "true":
            pytest.fail("POSTGRES_URL is not set in CI — refusing silent skip")
        pytest.skip("POSTGRES_URL is not set — schema check needs the docker Postgres")


async def test_tables_match_schema():
    require_postgres()
    # tables.py declares via SQLAlchemy Core; reflect the live DB and
    # compare column names per table.
    from _lib.countmein.db import tables as declared

    async with engine().connect() as conn:

        def _check(sync_conn) -> None:
            # Reflection is sync IO — it must run inside run_sync, or
            # SQLAlchemy raises MissingGreenlet on the first query.
            deflector = inspect(sync_conn)
            for name in TABLES:
                live = {c["name"] for c in deflector.get_columns(name)}
                decl = set(getattr(declared, name).columns.keys())
                # Declared must exist live (a missing column breaks every
                # query the module builds). Extra live columns are legacy
                # leftovers the queries never mention — not this test's
                # business (packages/db owns the schema).
                assert decl <= live, (
                    f"{name}: declared columns missing from live schema: {sorted(decl - live)}"
                )

            # Enum values must match the DB types. get_enums reflection is
            # unreliable for types outside the search path — read the
            # catalog directly instead.
            for enum_name, enum in ENUMS.items():
                rows = sync_conn.execute(
                    text(
                        "SELECT e.enumlabel FROM pg_enum e "
                        "JOIN pg_type t ON t.oid = e.enumtypid "
                        "WHERE t.typname = :name ORDER BY e.oid"
                    ),
                    {"name": enum_name},
                ).fetchall()
                live = {r[0] for r in rows}
                assert live, f"enum {enum_name} missing in live schema"
                assert live == set(enum.enums), (
                    f"enum {enum_name}: declared {sorted(enum.enums)} vs live {sorted(live)}"
                )

        await conn.run_sync(_check)
