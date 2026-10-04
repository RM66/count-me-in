"""Outbox repository: typed SQLAlchemy 2.0 queries over OutboxMessage."""

from __future__ import annotations

from collections.abc import Collection
from datetime import datetime
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.base import OutboxStatus
from ..models.outbox import OutboxMessage


async def enqueue_outbox(session: AsyncSession, rows: list[dict[str, Any]]) -> list[OutboxMessage]:
    """Insert pending rows inside the caller's transaction and hand them
    back (ids + stored payloads) for the inline publish + sent marking."""
    if not rows:
        return []
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    result = await session.execute(pg_insert(OutboxMessage).values(rows).returning(OutboxMessage))
    return list(result.scalars().all())


async def mark_sent(session: AsyncSession, id: str) -> None:
    await session.execute(
        update(OutboxMessage)
        .where(
            OutboxMessage.id == id,
            OutboxMessage.status == OutboxStatus.PENDING,
        )
        .values(status=OutboxStatus.SENT, sent_at=func.now())
    )


async def mark_skipped(session: AsyncSession, id: str) -> None:
    await session.execute(
        update(OutboxMessage)
        .where(
            OutboxMessage.id == id,
            OutboxMessage.status == OutboxStatus.PENDING,
        )
        .values(status=OutboxStatus.SKIPPED)
    )


async def bump_attempts(session: AsyncSession, id: str) -> int | None:
    result = await session.execute(
        update(OutboxMessage)
        .where(
            OutboxMessage.id == id,
            OutboxMessage.status == OutboxStatus.PENDING,
        )
        .values(attempts=OutboxMessage.attempts + 1)
        .returning(OutboxMessage.attempts)
    )
    value = result.scalar_one_or_none()
    return int(value) if value is not None else None


async def mark_failed(session: AsyncSession, id: str) -> None:
    await session.execute(
        update(OutboxMessage)
        .where(
            OutboxMessage.id == id,
            OutboxMessage.status == OutboxStatus.PENDING,
        )
        .values(status=OutboxStatus.FAILED)
    )


async def delete_sent_before(session: AsyncSession, cutoff: datetime) -> int:
    result = await session.execute(
        delete(OutboxMessage).where(
            OutboxMessage.status.in_([OutboxStatus.SENT, OutboxStatus.SKIPPED]),
            OutboxMessage.created_at < cutoff,
        )
    )
    return int(getattr(result, "rowcount", 0) or 0)


async def backlog(session: AsyncSession) -> tuple[int, datetime | None]:
    result = await session.execute(
        select(
            func.count().label("pending"),
            func.min(OutboxMessage.created_at).label("oldest"),
        )
        .select_from(OutboxMessage)
        .where(OutboxMessage.status == OutboxStatus.PENDING)
    )
    row = result.one()
    pending = int(row.pending)
    oldest = row.oldest
    return pending, oldest


async def claim_pending(
    session: AsyncSession, cutoff: datetime, exclude: Collection[str] = ()
) -> OutboxMessage | None:
    """Claim the oldest pending row past the grace period under
    FOR UPDATE SKIP LOCKED. The caller holds the transaction open for
    the whole publish+mark cycle, so two concurrent sweepers can never
    process the same row — the second skips the locked row and takes
    the next. The claim itself spends no retry budget: attempts move
    only when the row is actually processed.

    `exclude` drops rows this sweep already processed: a failed publish
    leaves the row pending, and without the exclusion the loop would
    re-claim it and burn the whole attempt budget in one sweep."""
    stmt = (
        select(OutboxMessage)
        .where(
            OutboxMessage.status == OutboxStatus.PENDING,
            OutboxMessage.created_at < cutoff,
            OutboxMessage.id.notin_(exclude),
        )
        .order_by(OutboxMessage.created_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()
