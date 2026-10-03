"""The outbox sweeper integration tests — the crash-recovery path the
mocked-transport handler tests cannot see (re-publish was broken by two
bugs patched transports never hit: an uncommitted attempts bump and a
UUID leaking into an HTTP header). Real Postgres; pins the row
lifecycle: pending → (failed publishes, budget spent) → failed, and
pending → sent on a successful re-publish."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import countmein.jobs.outbox_sweep as sweep_mod
import pytest
from countmein.db.client import engine
from countmein.jobs.outbox_sweep import (
    OUTBOX_MAX_ATTEMPTS,
    handle_outbox_sweep,
)
from sqlalchemy import text

pytestmark = pytest.mark.usefixtures("_require_postgres")


async def _insert_pending_row(queue: str = "booking.created") -> str:
    """Insert one backdated pending row (older than the grace period);
    return its id as the canonical wire string."""
    row_id = str(uuid.uuid4())
    async with engine().begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO notification_outbox (id, queue, payload, trace_id, status, attempts, created_at) "
                "VALUES (CAST(:id AS uuid), :queue, :payload, '', 'pending', 0, :created)"
            ),
            {
                "id": row_id,
                "queue": queue,
                "payload": '{"bookingId":"' + str(uuid.uuid4()) + '"}',
                "created": datetime.now(UTC) - timedelta(minutes=5),
            },
        )
    return row_id


async def _row_state(row_id: str) -> tuple[str, int]:
    async with engine().connect() as conn:
        row = (
            await conn.execute(
                text(
                    "SELECT status::text, attempts FROM notification_outbox "
                    "WHERE id = CAST(:id AS uuid)"
                ),
                {"id": row_id},
            )
        ).first()
    assert row is not None
    return str(row[0]), int(row[1])


async def _delete_row(row_id: str) -> None:
    async with engine().begin() as conn:
        await conn.execute(
            text("DELETE FROM notification_outbox WHERE id = CAST(:id AS uuid)"),
            {"id": row_id},
        )


@pytest.fixture()
def failing_publish(monkeypatch):
    """A publish that always fails retryably — the poisoned row."""

    async def _fail(queue_name, payload, dedup_id, trace_id=""):
        raise RuntimeError("poisoned publish")

    monkeypatch.setattr(sweep_mod, "publish_outbox", _fail)


@pytest.fixture()
def ok_publish(monkeypatch):
    """A publish that records the dedup id it was given — it must be a
    str (it goes straight into an HTTP header)."""
    seen: list[object] = []

    async def _ok(queue_name, payload, dedup_id, trace_id=""):
        seen.append(dedup_id)
        return None

    monkeypatch.setattr(sweep_mod, "publish_outbox", _ok)
    return seen


async def test_poisoned_row_reaches_failed(failing_publish):
    """The full recovery budget: every sweep spends one attempt (the bump
    must commit); past OUTBOX_MAX_ATTEMPTS the row moves to terminal
    `failed` instead of being rescanned forever."""
    row_id = await _insert_pending_row()
    try:
        for _ in range(OUTBOX_MAX_ATTEMPTS + 2):
            await handle_outbox_sweep()
            status, attempts = await _row_state(row_id)
            if status == "failed":
                break
            assert attempts > 0, "bump_outbox_attempts must commit its UPDATE"
        status, attempts = await _row_state(row_id)
        assert status == "failed"
        assert attempts == OUTBOX_MAX_ATTEMPTS
        # A failed row no longer matches the pending filter — one more
        # sweep must not resurrect it.
        await handle_outbox_sweep()
        status, _ = await _row_state(row_id)
        assert status == "failed"
    finally:
        await _delete_row(row_id)


async def test_successful_republish_marks_sent(ok_publish):
    row_id = await _insert_pending_row()
    try:
        await handle_outbox_sweep()
        status, attempts = await _row_state(row_id)
        assert status == "sent"
        assert attempts == 1
        # The dedup id is the row id as a plain string — a UUID object
        # would crash httpx with a TypeError on the header.
        assert ok_publish == [row_id]
    finally:
        await _delete_row(row_id)


async def test_publish_failure_spends_budget_and_stays_pending(failing_publish):
    """One failed publish: the row stays pending (the next sweep retries)
    but the attempt is spent — the budget is real."""
    row_id = await _insert_pending_row()
    try:
        await handle_outbox_sweep()
        status, attempts = await _row_state(row_id)
        assert status == "pending"
        assert attempts == 1
    finally:
        await _delete_row(row_id)
