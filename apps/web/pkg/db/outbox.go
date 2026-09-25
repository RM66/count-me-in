package db

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
)

// Transactional outbox for notification publishing. A row is written
// in the same transaction as the
// booking commit, carrying the queue name and the job payload (ids
// only). The inline publish runs after commit; on success it marks the
// row `sent` so the sweeper does not
// re-publish it. If the inline publish fails (function killed, network
// drop), the row stays `pending` and the sweeper re-publishes it past a
// grace period. Rows past the retry budget move to the terminal
// `failed` status; `sent` rows are deleted by retention.

// OutboxRow is one pending, sent or failed notification job.
type OutboxRow struct {
	ID        string
	Queue     string
	Payload   string
	TraceID   string
	Status    string
	Attempts  int
	CreatedAt time.Time
	SentAt    *time.Time
}

// EnqueueOutbox writes one outbox row inside the given transaction and
// returns it. The row is `pending` — the inline publish (which owns the
// row's delivery) or the sweeper will move it to `sent`. Call this
// before tx.Commit so the outbox row commits atomically with the
// booking it describes. The returned row lets the caller publish the
// exact stored payload and mark it `sent` by id.
//
// buildPayload receives the freshly generated outbox row id, so the
// payload can embed it as the consumer's idempotency key: the job
// handler SET-NX's on it, which makes a QStash retry or a sweeper
// re-publish unable to double-notify the same recipient.
func EnqueueOutbox(ctx context.Context, tx pgx.Tx, queue string, buildPayload func(outboxID string) any, traceID string) (OutboxRow, error) {
	row := OutboxRow{ID: newID(), Queue: queue, TraceID: traceID}
	body, err := json.Marshal(buildPayload(row.ID))
	if err != nil {
		return OutboxRow{}, err
	}
	row.Payload = string(body)
	_, err = tx.Exec(ctx, `
		INSERT INTO notification_outbox (id, queue, payload, trace_id, status, attempts)
		VALUES ($1::uuid, $2, $3, $4, 'pending', 0)`,
		row.ID, queue, row.Payload, row.TraceID)
	return row, err
}

// MarkOutboxSent moves a row to `sent` with a timestamp. Called by the
// inline publish after a successful QStash POST, and by the sweeper
// after a successful re-publish — so the row is delivered exactly once
// on the success path.
func MarkOutboxSent(ctx context.Context, id string) error {
	_, err := Pool().Exec(ctx, `
		UPDATE notification_outbox SET status = 'sent', sent_at = now()
		WHERE id = $1::uuid AND status = 'pending'`, id)
	return err
}

// MarkOutboxSkipped moves a row to the terminal `skipped` status.
// Dev-only: without QSTASH_TOKEN the publish is deliberately never
// attempted (localhost is not routable from Upstash), and recording
// that as `sent` would lie in the backlog metrics. Skipped rows never
// match the sweeper's `pending` filter and are removed by retention.
func MarkOutboxSkipped(ctx context.Context, id string) error {
	_, err := Pool().Exec(ctx, `
		UPDATE notification_outbox SET status = 'skipped'
		WHERE id = $1::uuid AND status = 'pending'`, id)
	return err
}

// BumpOutboxAttempts spends one retry-budget unit for a row that was
// actually processed (published or attempted), returning the
// post-increment value. Rows the sweeper skips on deadline never reach
// here, so a slow sweep no longer burns the budget without a send.
func BumpOutboxAttempts(ctx context.Context, id string) (int, error) {
	var attempts int
	err := Pool().QueryRow(ctx, `
		UPDATE notification_outbox SET attempts = attempts + 1
		WHERE id = $1::uuid AND status = 'pending'
		RETURNING attempts`, id).Scan(&attempts)
	return attempts, err
}

// MarkOutboxFailed moves a row past the retry budget to the terminal
// `failed` status. Terminal rows no longer match the sweeper's
// `pending` filter, so they cannot clog the batch (head-of-line
// blocking) and never get rescanned.
func MarkOutboxFailed(ctx context.Context, id string) error {
	_, err := Pool().Exec(ctx, `
		UPDATE notification_outbox SET status = 'failed'
		WHERE id = $1::uuid AND status = 'pending'`, id)
	return err
}

// DeleteSentOutboxBefore removes terminal `sent` and `skipped` rows
// older than the cutoff — retention so the table does not grow
// unbounded. Returns the number of deleted rows for the sweeper's log.
func DeleteSentOutboxBefore(ctx context.Context, cutoff time.Time) (int64, error) {
	tag, err := Pool().Exec(ctx, `
		DELETE FROM notification_outbox
		WHERE status IN ('sent', 'skipped') AND created_at < $1`, cutoff)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// OutboxBacklog reports the pending-row count and the age of the oldest
// pending row — the minimum alertable signal for the async pipeline.
// Called by the sweeper on every run so the
// numbers land in the logs on a schedule even when everything is fine.
func OutboxBacklog(ctx context.Context) (pending int64, oldestAge time.Duration, err error) {
	var oldest *time.Time
	err = Pool().QueryRow(ctx, `
		SELECT count(*), min(created_at) FROM notification_outbox WHERE status = 'pending'`).
		Scan(&pending, &oldest)
	if err != nil {
		return 0, 0, err
	}
	if oldest != nil {
		oldestAge = time.Since(*oldest)
	}
	return pending, oldestAge, nil
}

// SweepOutbox reads up to `limit` `pending` rows older than the grace
// period, returning them for the sweeper to publish. Rows are claimed
// with SELECT … FOR UPDATE SKIP LOCKED so two concurrent sweepers do
// not process the same batch while both transactions are open — but the
// claim spends no retry budget: `attempts` is bumped per row only when
// the row is actually processed (BumpOutboxAttempts), so rows left
// behind on deadline keep their budget for the next sweep. A duplicate
// delivery from overlapping sweeps is suppressed by the dedup id (the
// outbox row id) plus the consumer's idempotency guard.
func SweepOutbox(ctx context.Context, gracePeriod time.Duration, limit int) ([]OutboxRow, error) {
	cutoff := time.Now().Add(-gracePeriod)
	tx, err := Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(context.Background()) //nolint

	rows, err := tx.Query(ctx, `
		SELECT id, queue, payload, coalesce(trace_id, ''), status::text, attempts, created_at, sent_at
		FROM notification_outbox
		WHERE status = 'pending' AND created_at < $1
		ORDER BY created_at ASC
		LIMIT $2
		FOR UPDATE SKIP LOCKED`, cutoff, limit)
	if err != nil {
		return nil, err
	}
	out := []OutboxRow{}
	for rows.Next() {
		var r OutboxRow
		if err := rows.Scan(&r.ID, &r.Queue, &r.Payload, &r.TraceID, &r.Status, &r.Attempts, &r.CreatedAt, &r.SentAt); err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}
