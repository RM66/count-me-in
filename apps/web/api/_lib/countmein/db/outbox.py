"""Transactional outbox for notification publishing. A row is written
in the same transaction as the booking commit, carrying the queue name
and the job payload (ids only). The inline publish runs after commit;
on success it marks the row `sent` so the sweeper does not re-publish
it. If the inline publish fails (function killed, network drop), the
row stays `pending` and the sweeper re-publishes it past a grace
period. Rows past the retry budget move to the terminal `failed`
status; `sent` rows are deleted by retention.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from .client import engine
from .shared import new_id


@dataclass
class OutboxRow:
    """One pending, sent or failed notification job."""

    id: str
    queue: str
    trace_id: str
    status: str
    attempts: int
    created_at: datetime | None = None
    sent_at: datetime | None = None
    # Defaulted: enqueue_outbox builds the payload from the row id and
    # assigns it right after construction.
    payload: str = ""


async def enqueue_outbox(
    conn: AsyncConnection,
    queue: str,
    build_payload: Callable[[str], object],
    trace_id: str,
) -> OutboxRow:
    """Write one outbox row inside the given transaction and return it.
    The row is `pending` — the inline publish (which owns the row's
    delivery) or the sweeper will move it to `sent`. Call this before
    the commit so the outbox row commits atomically with the booking it
    describes. The returned row lets the caller publish the exact
    stored payload and mark it `sent` by id.

    build_payload receives the freshly generated outbox row id, so the
    payload can embed it as the consumer's idempotency key: the job
    handler SET-NX's on it, which makes a QStash retry or a sweeper
    re-publish unable to double-notify the same recipient."""
    row = OutboxRow(
        id=new_id(), queue=queue, trace_id=trace_id, status="pending", attempts=0, created_at=None
    )
    # default=str: row ids arrive as uuid.UUID from the database —
    # on the wire they are their canonical string form.
    row.payload = json.dumps(build_payload(row.id), separators=(",", ":"), default=str)
    await conn.execute(
        text(
            """
            INSERT INTO notification_outbox (id, queue, payload, trace_id, status, attempts)
            VALUES (:id, :queue, :payload, :trace_id, 'pending', 0)
            """
        ),
        {"id": row.id, "queue": queue, "payload": row.payload, "trace_id": row.trace_id},
    )
    return row


async def mark_outbox_sent(id: str) -> None:
    """Move a row to `sent` with a timestamp. Called by the inline
    publish after a successful QStash POST, and by the sweeper after a
    successful re-publish — so the row is delivered exactly once on the
    success path."""
    async with engine().begin() as conn:
        await conn.execute(
            text(
                "UPDATE notification_outbox SET status = 'sent', sent_at = now() "
                "WHERE id = :id AND status = 'pending'"
            ),
            {"id": id},
        )


async def mark_outbox_skipped(id: str) -> None:
    """Move a row to the terminal `skipped` status. Dev-only: without
    QSTASH_TOKEN the publish is deliberately never attempted (localhost
    is not routable from Upstash), and recording that as `sent` would
    lie in the backlog metrics. Skipped rows never match the sweeper's
    `pending` filter and are removed by retention."""
    async with engine().begin() as conn:
        await conn.execute(
            text(
                "UPDATE notification_outbox SET status = 'skipped' "
                "WHERE id = :id AND status = 'pending'"
            ),
            {"id": id},
        )


async def bump_outbox_attempts(id: str) -> int | None:
    """Spend one retry-budget unit for a row that was actually processed
    (published or attempted), returning the post-increment value. Rows
    the sweeper skips on deadline never reach here, so a slow sweep no
    longer burns the budget without a send."""
    async with engine().connect() as conn:
        result = await conn.execute(
            text(
                "UPDATE notification_outbox SET attempts = attempts + 1 "
                "WHERE id = :id AND status = 'pending' RETURNING attempts"
            ),
            {"id": id},
        )
        row = result.first()
        return row[0] if row is not None else None


async def mark_outbox_failed(id: str) -> None:
    """Move a row past the retry budget to the terminal `failed` status.
    Terminal rows no longer match the sweeper's `pending` filter, so
    they cannot clog the batch (head-of-line blocking) and never get
    rescanned."""
    async with engine().begin() as conn:
        await conn.execute(
            text(
                "UPDATE notification_outbox SET status = 'failed' "
                "WHERE id = :id AND status = 'pending'"
            ),
            {"id": id},
        )


async def delete_sent_outbox_before(cutoff: datetime) -> int:
    """Remove terminal `sent` and `skipped` rows older than the cutoff —
    retention so the table does not grow unbounded. Returns the number
    of deleted rows for the sweeper's log."""
    async with engine().begin() as conn:
        result = await conn.execute(
            text(
                "DELETE FROM notification_outbox "
                "WHERE status IN ('sent', 'skipped') AND created_at < :cutoff"
            ),
            {"cutoff": cutoff},
        )
        return result.rowcount


async def outbox_backlog() -> tuple[int, timedelta | None]:
    """The pending-row count and the age of the oldest pending row — the
    minimum alertable signal for the async pipeline. Called by the
    sweeper on every run so the numbers land in the logs on a schedule
    even when everything is fine."""
    async with engine().connect() as conn:
        result = await conn.execute(
            text(
                "SELECT count(*), min(created_at) FROM notification_outbox WHERE status = 'pending'"
            )
        )
        row = result.first()
    pending = int(row[0])  # type: ignore[index]
    oldest_age: timedelta | None = None
    if row[1] is not None:  # type: ignore[index]
        oldest_age = datetime.now(UTC) - row[1]  # type: ignore[index]
    return pending, oldest_age


async def sweep_outbox(grace_period: timedelta, limit: int) -> list[OutboxRow]:
    """Read up to `limit` `pending` rows older than the grace period,
    returning them for the sweeper to publish. Rows are claimed with
    SELECT … FOR UPDATE SKIP LOCKED so two concurrent sweepers do not
    process the same batch while both transactions are open — but the
    claim spends no retry budget: `attempts` is bumped per row only
    when the row is actually processed (bump_outbox_attempts), so rows
    left behind on deadline keep their budget for the next sweep. A
    duplicate delivery from overlapping sweeps is suppressed by the
    dedup id (the outbox row id) plus the consumer's idempotency
    guard."""
    cutoff = datetime.now(UTC) - grace_period
    async with engine().begin() as conn:
        result = await conn.execute(
            text(
                """
                SELECT id, queue, payload, coalesce(trace_id, ''), status::text, attempts, created_at, sent_at
                FROM notification_outbox
                WHERE status = 'pending' AND created_at < :cutoff
                ORDER BY created_at ASC
                LIMIT :limit
                FOR UPDATE SKIP LOCKED
                """
            ),
            {"cutoff": cutoff, "limit": limit},
        )
        return [
            OutboxRow(
                id=r[0],
                queue=r[1],
                payload=r[2],
                trace_id=r[3],
                status=r[4],
                attempts=r[5],
                created_at=r[6],
                sent_at=r[7],
            )
            for r in result
        ]
