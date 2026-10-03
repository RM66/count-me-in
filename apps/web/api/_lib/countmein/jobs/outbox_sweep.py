"""Outbox sweeper.

The inline publish after a booking commit can fail silently (function
killed, network drop), leaving the transactional outbox row `pending`.
This handler — invoked by a QStash cron schedule (QUEUE_OUTBOX_SWEEP) —
re-publishes `pending` rows past a grace period to their original
queue, marking them `sent` on success.

The grace period (30s) exceeds the inline publish's 1.5s budget, so the
sweeper does not race it: a published row is already `sent` and skipped.
If both paths publish the same row, the Upstash-Deduplication-Id (the
row id) suppresses the duplicate delivery.

Rows past outbox_max_attempts move to the terminal `failed` status — no
longer matching `pending`, so they cannot clog the batch. `sent` rows
past the retention window are deleted so the table stays bounded."""

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

# Per-row publish budget. maxDuration is 10s and a batch holds 50 rows;
# a sweep that doesn't watch the clock gets killed mid-batch. Aborting
# when the remaining time can't cover one publish leaves the rest for
# the next sweep with attempts unspent (budget is spent per processed
# row, not at claim time).
SWEEP_ROW_BUDGET = 2.0

# Wall-clock budget for one batch — the runtime enforces maxDuration
# (10s) by killing the instance, so the handler budgets itself. A
# module-level variable, not a constant: tests shrink it.
SWEEP_FUNCTION_BUDGET = 8.0


def _reset_for_test(function_budget: float | None = None) -> None:
    global SWEEP_FUNCTION_BUDGET
    SWEEP_FUNCTION_BUDGET = function_budget if function_budget is not None else 8.0


async def handle_outbox_sweep() -> None:
    started = time.monotonic()
    # Worker context, not a request — the sweeper owns its session; each
    # service call wraps its own begin().
    async with sessionmaker()() as session:
        # Backlog metric every sweep: "pending growing" + "oldest aging"
        # is the cheapest alertable signal for the async pipeline.
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
            # Stop before starting a publish the remaining budget can't
            # cover. Skipped rows keep their attempts unspent — the next
            # sweep picks them up on equal terms.
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

            # Re-publish to the original queue; the payload carries ids
            # only. The row id doubles as dedup id, so an already-done
            # delivery (inline or earlier sweep) is suppressed.
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
                # Spend the attempt — the row was processed and failed;
                # stays pending for the next sweep.
                try:
                    await bump_outbox_attempts(session, row.id)
                except Exception as berr:
                    logx.error(berr, {"outboxId": row.id, "source": "outbox-bump-attempts"})
                continue  # leave pending — the next sweep retries

            # Bump-then-sent keeps `attempts` honest about how many
            # sweep rounds the row cost.
            try:
                await bump_outbox_attempts(session, row.id)
            except Exception as err:
                logx.error(err, {"outboxId": row.id, "source": "outbox-bump-attempts"})
            try:
                await mark_outbox_sent(session, row.id)
            except Exception as err:
                logx.error(err, {"outboxId": row.id, "source": "outbox-mark-sent"})

        # `sent` rows have no diagnostic value past the window — the
        # trace id lives in logs, not the table.
        try:
            deleted = await delete_sent_outbox_before(
                session, datetime.now(tz=UTC) - OUTBOX_SENT_RETENTION
            )
            if deleted > 0:
                logx.info("outbox retention deleted sent rows", {"deleted": deleted})
        except Exception as err:
            logx.error(err, {"source": "outbox-retention"})
