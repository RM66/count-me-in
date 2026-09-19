package jobs

import (
	"context"
	"encoding/json"
	"time"

	"countmein/pkg/contracts"
	"countmein/pkg/db"
	"countmein/pkg/logx"
	"countmein/pkg/queue"
)

// Outbox sweeper (architecture review fix #3).
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
// skips it.

const (
	outboxGracePeriod = 30 * time.Second
	outboxBatchLimit  = 50
	outboxMaxAttempts = 10
)

// HandleOutboxSweep reads pending outbox rows and re-publishes them.
// Each row is published to its original queue; on success the row is
// marked `sent`. Rows past outboxMaxAttempts are abandoned (logged) so
// a permanently failing job does not retry forever.
func HandleOutboxSweep(ctx context.Context) error {
	rows, err := db.SweepOutbox(ctx, outboxGracePeriod, outboxBatchLimit)
	if err != nil {
		return err
	}

	for _, row := range rows {
		if row.Attempts > outboxMaxAttempts {
			logx.Info("outbox row exceeded max attempts — abandoning", map[string]any{
				"outboxId": row.ID,
				"queue":    row.Queue,
				"attempts": row.Attempts,
			})
			continue
		}

		// Re-publish to the original queue. The payload is the raw JSON
		// stored in the outbox row — it carries ids only (no secrets).
		if err := publishOutboxRow(ctx, row); err != nil {
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
	return nil
}

// publishOutboxRow publishes one outbox row's payload to its queue.
// The payload is the raw JSON from the outbox — it is the same job body
// the inline publish would have sent.
func publishOutboxRow(ctx context.Context, row db.OutboxRow) error {
	var raw json.RawMessage = json.RawMessage(row.Payload)
	return queue.PublishRaw(ctx, row.Queue, raw)
}

// QueueOutboxSweep is exported for the ensure-qstash script to register
// the cron schedule.
var QueueOutboxSweep = contracts.QueueOutboxSweep
