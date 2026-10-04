"""Transactional outbox for notification publishing (ADR-012).

A row is written in the same transaction as the booking commit,
carrying the queue name and the job payload (ids only). The inline
publish runs after commit; on success it marks the row `sent` so the
sweeper does not re-publish it. If the inline publish fails (function
killed, network drop), the row stays `pending` and the sweeper
re-publishes it past a grace period. Rows past the retry budget move to
the terminal `failed` status; `sent` rows are deleted by retention.

Like every service module, these functions take the caller's
AsyncSession; the sweeper (a worker, not a request) opens its own.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from ..db.shared import new_id
from ..models.outbox import OutboxMessage
from ..queue import PublishSkipped
from ..repositories import outbox_repo


async def enqueue_outbox_tx(
    session: AsyncSession,
    queue: str,
    build_payload: Callable[[str], object],
    trace_id: str,
) -> OutboxMessage:
    """Write one outbox row inside the given transaction and return it.
    The row is `pending` — the inline publish (which owns delivery) or
    the sweeper moves it to `sent`. Call before commit so the row
    commits atomically with the booking. The returned row lets the
    caller publish the exact stored payload and mark it `sent` by id.

    build_payload receives the fresh row id so the payload embeds it as
    the consumer's idempotency key: the job handler SET-NX's on it, so a
    QStash retry or sweeper re-publish cannot double-notify."""
    row_id = new_id()
    payload = json.dumps(build_payload(row_id), separators=(",", ":"), default=str)
    rows = await outbox_repo.enqueue_outbox(
        session, [{"id": row_id, "queue": queue, "payload": payload, "trace_id": trace_id}]
    )
    return rows[0]


async def settle_publish(session: AsyncSession, row_id: str, outcome: BaseException | None) -> bool:
    """Terminal-settle one publish outcome inside the caller's
    transaction: `sent` on a delivered POST, `skipped` on the dev
    sentinel. Returns False on a publish failure — the caller decides
    whether the attempt cost budget (the sweeper spends one, the inline
    path leaves the row untouched for the next publish)."""
    if outcome is None:
        await outbox_repo.mark_sent(session, row_id)
        return True
    if isinstance(outcome, PublishSkipped):
        await outbox_repo.mark_skipped(session, row_id)
        return True
    return False


async def outbox_backlog(session: AsyncSession) -> tuple[int, timedelta | None]:
    """Pending-row count and oldest pending age — the minimum alertable
    signal for the pipeline. The sweeper emits it every run so the
    numbers land in the logs even when all is fine."""
    pending, oldest = await outbox_repo.backlog(session)
    oldest_age: timedelta | None = None
    if oldest is not None:
        oldest_age = datetime.now(UTC) - oldest
    return pending, oldest_age
