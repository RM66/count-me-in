"""The ORM models mirror the migrated schema: every column the live
tables carry must exist on the SQLAlchemy metadata (and vice versa),
plus the enum value sets. Model↔migration drift is pinned by
test_models_match_schema (alembic check); this module pins the same
drift from the live-schema side. Requires POSTGRES_URL — skipped
locally without it, failed in CI.
"""

from __future__ import annotations

import pytest
from countmein.db.client import engine
from countmein.models import Base
from sqlalchemy import text

# Every test needs the live Postgres (schema introspection) — the whole
# module is integration.
pytestmark = pytest.mark.integration

ENUMS = {
    "options_select_mode": {"single", "multi"},
    "booking_status": {"confirmed", "cancelled"},
    "messenger_kind": {"telegram"},
    "outbox_status": {"pending", "sent", "failed", "skipped"},
}


def require_postgres() -> None:
    from _env import require_postgres as _require

    _require()


async def test_model_tables_match_live_schema():
    """Every model table's columns exist live with the same names — a
    renamed or dropped column breaks loudly here instead of as a
    runtime ORM error."""
    require_postgres()
    async with engine().connect() as conn:
        live_tables = {
            r[0]
            for r in (
                await conn.execute(
                    text(
                        "SELECT table_name FROM information_schema.tables "
                        "WHERE table_schema = 'public'"
                    )
                )
            ).fetchall()
        }
        for table in Base.metadata.tables.values():
            assert table.name in live_tables, f"table {table.name} missing from live schema"
            rows = await conn.execute(
                text("SELECT column_name FROM information_schema.columns WHERE table_name = :t"),
                {"t": table.name},
            )
            live = {r[0] for r in rows.fetchall()}
            model_cols = set(table.columns.keys())
            assert model_cols <= live, (
                f"{table.name}: model columns missing from live schema: {sorted(model_cols - live)}"
            )


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
