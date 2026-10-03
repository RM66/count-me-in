"""demo.refresh — recurring refresh of the demo seed (ADR-010), produced
by a QStash schedule created by apps/web/scripts/ensure-qstash.ts. Demo
slot times are relative to seed time, so a demo left alone drifts into
the past. seed_demo is idempotent and replaces slots and bookings in
place."""

from __future__ import annotations

from datetime import UTC, datetime

from .. import logx
from ..db.seed import seed_demo


async def handle_demo_refresh() -> None:
    logx.info("reseeding the demo organizer", None)
    await seed_demo(datetime.now(tz=UTC))
    logx.info("demo seed refreshed", None)
