"""Outbox sweeper.

The inline publish after a booking commit can fail silently (function
killed, network drop), leaving the transactional outbox row `pending`.
This handler — invoked by a QStash cron schedule (QUEUE_NOTIFICATION_OUTBOX_SWEEP) —
re-publishes `pending` rows past a grace period to their original
queue, marking them `sent` on success.

The grace period (30s) exceeds the inline publish's 1.5s budget, so the
sweeper does not race it: a published row is already `sent` and skipped.
If both paths publish the same row, the Upstash-Deduplication-Id (the
row id) suppresses the duplicate delivery.

Mutual exclusion is real, not docstring: each row is claimed with
FOR UPDATE SKIP LOCKED and the claim's transaction stays open through
publish + mark, so a concurrent sweeper skips the locked row and takes
the next — the same row can never be published twice by two sweepers.
The claim itself spends no retry budget: attempts move only when the
row is actually processed.

Rows past OUTBOX_MAX_ATTEMPTS move to the terminal `failed` status — no
longer matching `pending`, so they cannot clog the batch. `sent` rows
past the retention window are deleted so the table stays bounded.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from .. import logx
from ..db.client import sessionmaker
from ..queue import PublishSkipped, publish_outbox
from ..repositories import outbox_repo
from ..services.outbox_service import outbox_backlog, settle_publish

OUTBOX_GRACE_PERIOD = timedelta(seconds=30)
OUTBOX_BATCH_LIMIT = 50
OUTBOX_MAX_ATTEMPTS = 10
OUTBOX_SENT_RETENTION = timedelta(days=7)

# Per-row publish budget. maxDuration is 10s and a batch holds 50 rows;
# a sweep that doesn't watch the clock gets killed mid-batch. Aborting
# when the remaining time can't cover one publish leaves the rest for
# the next sweep with attempts unspent (budget is spent per processed
# row, not at claim time).
SWEEP_ROW_BUDGET = 2.0

# Wall-clock budget for one batch — the runtime enforces maxDuration
# (10s) by killing the instance, so the handler budgets itself.
SWEEP_FUNCTION_BUDGET = 8.0


async def _sweep_one(session: AsyncSession, cutoff: datetime, claimed: set[str]) -> bool:
    """Claim → publish → mark for ONE row in ONE transaction: the
    SKIP LOCKED claim is held until commit, so a second sweeper takes a
    different row. Rows are independent — a publish failure rolls back
    nothing but its own marks (the bump is in this tx). `claimed`
    records the row id so the sweep cannot re-claim it."""
    async with session.begin():
        row = await outbox_repo.claim_pending(session, cutoff, claimed)
        if row is None:
            return False
        claimed.add(row.id)

        if row.attempts >= OUTBOX_MAX_ATTEMPTS:
            logx.info(
                "outbox row exceeded max attempts — marking failed",
                {"outboxId": row.id, "queue": row.queue, "attempts": row.attempts},
            )
            await outbox_repo.mark_failed(session, row.id)
            return True

        # Re-publish to the original queue; the payload carries ids
        # only. The row id doubles as dedup id, so an already-done
        # delivery (inline or earlier sweep) is suppressed.
        outcome: BaseException | None = None
        try:
            await publish_outbox(row.queue, row.payload, row.id, row.trace_id or "")
        except Exception as err:
            outcome = err

        if outcome is not None and not isinstance(outcome, PublishSkipped):
            logx.error(
                outcome,
                {"outboxId": row.id, "queue": row.queue, "source": "outbox-sweep"},
            )
            # Spend the attempt — the row was processed and failed;
            # stays pending for the next sweep.
            await outbox_repo.bump_attempts(session, row.id)
            return True

        # Bump-then-settle keeps `attempts` honest about how many sweep
        # rounds the row cost (sent counts, skipped does not).
        if outcome is None:
            await outbox_repo.bump_attempts(session, row.id)
        await settle_publish(session, row.id, outcome)
        return True


async def handle_outbox_sweep() -> None:
    started = time.monotonic()
    # Worker context, not a request — the sweeper owns its session; the
    # per-row cycle wraps its own begin() so each claim's lock lives
    # exactly as long as its publish.
    async with sessionmaker()() as session:
        # Backlog metric every sweep: "pending growing" + "oldest aging"
        # is the cheapest alertable signal for the async pipeline.
        try:
            # Its own transaction — the read must commit so the per-row
            # claim cycles below each open a fresh one.
            async with session.begin():
                pending, oldest_age = await outbox_backlog(session)
            logx.info(
                "outbox backlog",
                {
                    "pending": pending,
                    "oldestAgeS": int(oldest_age.total_seconds()) if oldest_age else 0,
                },
            )
        except Exception as err:
            logx.error(err, {"source": "outbox-backlog"})

        cutoff = datetime.now(tz=UTC) - OUTBOX_GRACE_PERIOD
        processed = 0
        claimed: set[str] = set()
        while processed < OUTBOX_BATCH_LIMIT:
            # Stop before starting a publish the remaining budget can't
            # cover. Unclaimed rows keep their attempts unspent — the
            # next sweep picks them up on equal terms.
            if time.monotonic() - started + SWEEP_ROW_BUDGET > SWEEP_FUNCTION_BUDGET:
                logx.info(
                    "outbox sweep out of time — leaving the rest for the next sweep",
                    {"processed": processed},
                )
                break
            if not await _sweep_one(session, cutoff, claimed):
                break
            processed += 1
        if processed:
            logx.info("outbox sweep processed rows", {"processed": processed})

        # `sent` rows have no diagnostic value past the window — the
        # trace id lives in logs, not the table.
        try:
            async with session.begin():
                deleted = await outbox_repo.delete_sent_before(
                    session, datetime.now(tz=UTC) - OUTBOX_SENT_RETENTION
                )
            if deleted > 0:
                logx.info("outbox retention deleted sent rows", {"deleted": deleted})
        except Exception as err:
            logx.error(err, {"source": "outbox-retention"})
