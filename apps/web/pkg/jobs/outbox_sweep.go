package jobs

import (
	"context"
	"time"

	"countmein/pkg/contracts"
	"countmein/pkg/db"
	"countmein/pkg/logx"
	"countmein/pkg/queue"
)

// Outbox sweeper.
//
// The inline publish after a booking commit can fail silently (function
// killed, network drop). The transactional outbox row written in the same
// transaction stays `pending`. This handler — invoked by a QStash cron
// schedule (QUEUE_OUTBOX_SWEEP) — reads `pending` rows past a grace
// period and re-publishes them to their original queue, marking them
// `sent` on success.
//
// The grace period (30s) is longer than the inline publish's 1.5s
// context, so the sweeper does not race the inline publish: if the
// inline publish succeeded, the row is already `sent` and the sweeper
// skips it. If both paths somehow publish the same row, the
// Upstash-Deduplication-Id (the outbox row id) suppresses the duplicate
// delivery.
//
// Rows past outboxMaxAttempts move to the terminal `failed` status —
// they no longer match the `pending` filter, so they cannot clog the
// batch (head-of-line blocking) and never get rescanned. `sent` rows
// older than the retention window are deleted so the table does not
// grow unbounded.

const (
	outboxGracePeriod   = 30 * time.Second
	outboxBatchLimit    = 50
	outboxMaxAttempts   = 10
	outboxSentRetention = 7 * 24 * time.Hour
)

// HandleOutboxSweep reads pending outbox rows and re-publishes them.
// Each row is published to its original queue; on success the row is
// marked `sent`. Rows past outboxMaxAttempts are moved to `failed`
// (terminal, logged) so a permanently failing job does not retry
// forever and does not block the batch.
func HandleOutboxSweep(ctx context.Context) error {
	// Backlog metric: emitted every sweep so
	// "pending rows growing" and "oldest pending aging" are visible in
	// the logs — the cheapest alertable signal for the async pipeline.
	if pending, oldestAge, err := db.OutboxBacklog(ctx); err != nil {
		logx.Error(err, map[string]any{"source": "outbox-backlog"})
	} else {
		logx.Info("outbox backlog", map[string]any{
			"pending":    pending,
			"oldestAgeS": int64(oldestAge.Seconds()),
		})
	}

	rows, err := db.SweepOutbox(ctx, outboxGracePeriod, outboxBatchLimit)
	if err != nil {
		return err
	}

	for _, row := range rows {
		if row.Attempts > outboxMaxAttempts {
			logx.Info("outbox row exceeded max attempts — marking failed", map[string]any{
				"outboxId": row.ID,
				"queue":    row.Queue,
				"attempts": row.Attempts,
			})
			if err := db.MarkOutboxFailed(ctx, row.ID); err != nil {
				logx.Error(err, map[string]any{
					"outboxId": row.ID,
					"source":   "outbox-mark-failed",
				})
			}
			continue
		}

		// Re-publish to the original queue. The payload is the raw JSON
		// stored in the outbox row — it carries ids only (no secrets).
		// The row id doubles as the dedup id, so a delivery that
		// already happened (inline path or an earlier sweep) is
		// suppressed by QStash instead of duplicated.
		if err := queue.PublishOutbox(ctx, row.Queue, []byte(row.Payload), row.ID, row.TraceID); err != nil {
			logx.Error(err, map[string]any{
				"outboxId": row.ID,
				"queue":    row.Queue,
				"source":   "outbox-sweep",
			})
			continue // leave pending — the next sweep retries
		}

		// Mark sent so the next sweep skips it.
		if err := db.MarkOutboxSent(ctx, row.ID); err != nil {
			logx.Error(err, map[string]any{
				"outboxId": row.ID,
				"source":   "outbox-mark-sent",
			})
		}
	}

	// Retention: `sent` rows have no diagnostic value past the
	// window — the trace id lives in logs, not in the table.
	if deleted, err := db.DeleteSentOutboxBefore(ctx, time.Now().Add(-outboxSentRetention)); err != nil {
		logx.Error(err, map[string]any{"source": "outbox-retention"})
	} else if deleted > 0 {
		logx.Info("outbox retention deleted sent rows", map[string]any{"deleted": deleted})
	}
	return nil
}

// QueueOutboxSweep is exported for the ensure-qstash script to register
// the cron schedule.
var QueueOutboxSweep = contracts.QueueOutboxSweep
