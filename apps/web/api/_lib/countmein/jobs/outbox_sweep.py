"""Outbox sweeper.

The inline publish after a booking commit can fail silently (function
killed, network drop). The transactional outbox row written in the same
transaction stays `pending`. This handler — invoked by a QStash cron
schedule (QUEUE_OUTBOX_SWEEP) — reads `pending` rows past a grace
period and re-publishes them to their original queue, marking them
`sent` on success.

The grace period (30s) is longer than the inline publish's 1.5s
context, so the sweeper does not race the inline publish: if the inline
publish succeeded, the row is already `sent` and the sweeper skips it.
If both paths somehow publish the same row, the
Upstash-Deduplication-Id (the outbox row id) suppresses the duplicate
delivery.

Rows past outbox_max_attempts move to the terminal `failed` status —
they no longer match the `pending` filter, so they cannot clog the
batch (head-of-line blocking) and never get rescanned. `sent` rows
older than the retention window are deleted so the table does not grow
unbounded."""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta

from .. import logx
from ..db.client import sessionmaker
from ..queue import PublishSkipped, publish_outbox
from ..services.outbox_service import (
    bump_outbox_attempts,
    delete_sent_outbox_before,
    mark_outbox_failed,
    mark_outbox_sent,
    mark_outbox_skipped,
    outbox_backlog,
    sweep_outbox,
)

OUTBOX_GRACE_PERIOD = timedelta(seconds=30)
OUTBOX_BATCH_LIMIT = 50
OUTBOX_MAX_ATTEMPTS = 10
OUTBOX_SENT_RETENTION = timedelta(days=7)

# The per-row publish budget. The function's maxDuration is 10s and the
# batch can hold 50 rows; a sweep that publishes sequentially without
# watching the clock gets killed mid-batch. Aborting when the remaining
# time no longer covers one publish leaves the rest of the batch for
# the next sweep — with their attempts unspent, because the budget is
# spent per processed row, not at claim time.
SWEEP_ROW_BUDGET = 2.0

# The wall-clock budget for one batch. The runtime enforces maxDuration
# (10s in vercel.json) by killing the instance, so the handler budgets
# itself instead. Module-level, not a constant: tests shrink it to pin
# the abort path.
SWEEP_FUNCTION_BUDGET = 8.0


def _reset_for_test(function_budget: float | None = None) -> None:
    global SWEEP_FUNCTION_BUDGET
    SWEEP_FUNCTION_BUDGET = function_budget if function_budget is not None else 8.0


async def handle_outbox_sweep() -> None:
    started = time.monotonic()
    # Worker context, not a request — the sweeper owns its session for
    # the whole run; every service call below wraps its own begin().
    async with sessionmaker()() as session:
        # Backlog metric: emitted every sweep so "pending rows growing" and
        # "oldest pending aging" are visible in the logs — the cheapest
        # alertable signal for the async pipeline.
        try:
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

        rows = await sweep_outbox(session, OUTBOX_GRACE_PERIOD, OUTBOX_BATCH_LIMIT)

        for i, row in enumerate(rows):
            # Deadline discipline: stop before starting a publish the
            # remaining function budget no longer covers. Rows left behind
            # keep their attempts unspent — the budget is spent per
            # processed row below, not at claim time — so the next sweep
            # (2 minutes later) picks them up on equal terms.
            if time.monotonic() - started + SWEEP_ROW_BUDGET > SWEEP_FUNCTION_BUDGET:
                logx.info(
                    "outbox sweep out of time — leaving the rest for the next sweep",
                    {"remaining": len(rows) - i},
                )
                break

            if row.attempts >= OUTBOX_MAX_ATTEMPTS:
                logx.info(
                    "outbox row exceeded max attempts — marking failed",
                    {"outboxId": row.id, "queue": row.queue, "attempts": row.attempts},
                )
                try:
                    await mark_outbox_failed(session, row.id)
                except Exception as err:
                    logx.error(err, {"outboxId": row.id, "source": "outbox-mark-failed"})
                continue

            # Re-publish to the original queue. The payload is the raw JSON
            # stored in the outbox row — it carries ids only (no secrets).
            # The row id doubles as the dedup id, so a delivery that
            # already happened (inline path or an earlier sweep) is
            # suppressed by QStash instead of duplicated.
            try:
                await publish_outbox(row.queue, row.payload, row.id, row.trace_id)
            except PublishSkipped:
                try:
                    await mark_outbox_skipped(session, row.id)
                except Exception as err:
                    logx.error(err, {"outboxId": row.id, "source": "outbox-mark-skipped"})
                continue
            except Exception as err:
                logx.error(err, {"outboxId": row.id, "queue": row.queue, "source": "outbox-sweep"})
                # Spend the attempt: the row was processed and failed —
                # leave pending, the next sweep retries within budget.
                try:
                    await bump_outbox_attempts(session, row.id)
                except Exception as berr:
                    logx.error(berr, {"outboxId": row.id, "source": "outbox-bump-attempts"})
                continue  # leave pending — the next sweep retries

            # Spend the attempt, then mark sent so the next sweep skips it.
            # Bump-then-sent keeps the attempts column honest about how
            # many sweep rounds the row cost.
            try:
                await bump_outbox_attempts(session, row.id)
            except Exception as err:
                logx.error(err, {"outboxId": row.id, "source": "outbox-bump-attempts"})
            try:
                await mark_outbox_sent(session, row.id)
            except Exception as err:
                logx.error(err, {"outboxId": row.id, "source": "outbox-mark-sent"})

        # Retention: `sent` rows have no diagnostic value past the window —
        # the trace id lives in logs, not in the table.
        try:
            deleted = await delete_sent_outbox_before(
                session, datetime.now(tz=UTC) - OUTBOX_SENT_RETENTION
            )
            if deleted > 0:
                logx.info("outbox retention deleted sent rows", {"deleted": deleted})
        except Exception as err:
            logx.error(err, {"source": "outbox-retention"})
