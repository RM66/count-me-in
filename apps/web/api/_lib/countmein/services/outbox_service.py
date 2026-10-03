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

from ..db.rows import OutboxRow, _str
from ..db.shared import new_id
from ..repositories import outbox_repo


async def enqueue_outbox_tx(
    session: AsyncSession,
    queue: str,
    build_payload: Callable[[str], object],
    trace_id: str,
) -> OutboxRow:
    """Write one outbox row inside the given transaction and return it.
    The row is `pending` — the inline publish (which owns delivery) or
    the sweeper moves it to `sent`. Call before commit so the row
    commits atomically with the booking. The returned row lets the
    caller publish the exact stored payload and mark it `sent` by id.

    build_payload receives the fresh row id so the payload embeds it as
    the consumer's idempotency key: the job handler SET-NX's on it, so a
    QStash retry or sweeper re-publish cannot double-notify."""
    row = OutboxRow(
        id=new_id(), queue=queue, trace_id=trace_id, status="pending", attempts=0, created_at=None
    )
    # default=str: row ids arrive as uuid.UUID — on the wire they are
    # the canonical string.
    row.payload = json.dumps(build_payload(row.id), separators=(",", ":"), default=str)
    await outbox_repo.enqueue_outbox(
        session, [{"id": row.id, "queue": queue, "payload": row.payload, "trace_id": row.trace_id}]
    )
    return row


async def mark_outbox_sent(session: AsyncSession, id: str) -> None:
    """Move a row to `sent` with a timestamp. Called by the inline
    publish after a successful QStash POST, and by the sweeper after a
    re-publish."""
    async with session.begin():
        await outbox_repo.mark_sent(session, id)


async def mark_outbox_skipped(session: AsyncSession, id: str) -> None:
    """Move a row to the terminal `skipped` status. Dev-only: without
    QSTASH_TOKEN the publish is never attempted (localhost is not
    routable from Upstash), and `sent` would lie in the backlog metrics.
    Skipped rows never match `pending` and are removed by retention."""
    async with session.begin():
        await outbox_repo.mark_skipped(session, id)


async def bump_outbox_attempts(session: AsyncSession, id: str) -> int | None:
    """Spend one retry-budget unit for a row actually processed,
    returning the post-increment value. Rows the sweeper skips on
    deadline never reach here — a slow sweep burns no budget."""
    async with session.begin():
        return await outbox_repo.bump_attempts(session, id)


async def mark_outbox_failed(session: AsyncSession, id: str) -> None:
    """Move a row past the retry budget to terminal `failed` — no longer
    matching `pending`, so it cannot clog the batch or be rescanned."""
    async with session.begin():
        await outbox_repo.mark_failed(session, id)


async def delete_sent_outbox_before(session: AsyncSession, cutoff: datetime) -> int:
    """Remove terminal `sent` and `skipped` rows older than the cutoff —
    retention so the table does not grow unbounded. Returns the number
    of deleted rows for the sweeper's log."""
    async with session.begin():
        return await outbox_repo.delete_sent_before(session, cutoff)


async def outbox_backlog(session: AsyncSession) -> tuple[int, timedelta | None]:
    """Pending-row count and oldest pending age — the minimum alertable
    signal for the pipeline. The sweeper emits it every run so the
    numbers land in the logs even when all is fine."""
    async with session.begin():
        pending, oldest = await outbox_repo.backlog(session)
    oldest_age: timedelta | None = None
    if oldest is not None:
        oldest_age = datetime.now(UTC) - oldest
    return pending, oldest_age


async def sweep_outbox(
    session: AsyncSession, grace_period: timedelta, limit: int
) -> list[OutboxRow]:
    """Read up to `limit` `pending` rows older than the grace period for
    the sweeper to publish. Rows are claimed with FOR UPDATE SKIP LOCKED
    so two concurrent sweepers cannot process the same batch — but the
    claim spends no budget: `attempts` bumps only per processed row, so
    rows left behind on deadline keep theirs. A duplicate delivery from
    overlapping sweeps is suppressed by the dedup id plus the consumer's
    idempotency guard."""
    cutoff = datetime.now(UTC) - grace_period
    async with session.begin():
        models = await outbox_repo.sweep_pending(session, cutoff, limit)
    return [
        OutboxRow(
            # _str: psycopg hands back a UUID; the row id is a wire
            # string (dedup header, logs).
            id=_str(m.id),
            queue=m.queue,
            payload=m.payload if isinstance(m.payload, str) else _str(m.payload),
            trace_id=m.trace_id or "",
            status=str(m.status.value if hasattr(m.status, "value") else m.status),
            attempts=m.attempts,
            created_at=m.created_at,
            sent_at=m.sent_at,
        )
        for m in models
    ]
