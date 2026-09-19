package db

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
)

// Transactional outbox for notification publishing (architecture
// review fix #3). A row is written in the same transaction as the
// booking commit, carrying the queue name and the job payload (ids
// only). The inline publish runs after commit as before; if it fails
// (function killed, network drop), the sweeper job reads `pending`
// rows past a grace period and re-publishes them, marking them `sent`
// on success. This closes the loss window between commit and publish.

// OutboxRow is one pending or sent notification job.
type OutboxRow struct {
	ID        string
	Queue     string
	Payload   string
	Status    string
	Attempts  int
	CreatedAt time.Time
	SentAt    *time.Time
}

// EnqueueOutbox writes one outbox row inside the given transaction. The
// row is `pending` — the inline publish or the sweeper will move it to
// `sent`. Call this before tx.Commit so the outbox row commits atomically
// with the booking it describes.
func EnqueueOutbox(ctx context.Context, tx pgx.Tx, queue string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO notification_outbox (id, queue, payload, status, attempts)
		VALUES ($1::uuid, $2, $3, 'pending', 0)`,
		newID(), queue, string(body))
	return err
}

// MarkOutboxSent moves a row to `sent` with a timestamp. Called by the
// inline publish after a successful QStash POST, so the sweeper does
// not re-publish it.
func MarkOutboxSent(ctx context.Context, id string) error {
	_, err := Pool().Exec(ctx, `
		UPDATE notification_outbox SET status = 'sent', sent_at = now()
		WHERE id = $1::uuid AND status = 'pending'`, id)
	return err
}

// SweepOutbox reads up to `limit` `pending` rows older than the grace
// period, returning them for the sweeper to publish. Each row's
// `attempts` is incremented atomically (SELECT … FOR UPDATE SKIP LOCKED
// + UPDATE) so concurrent sweepers do not double-publish.
func SweepOutbox(ctx context.Context, gracePeriod time.Duration, limit int) ([]OutboxRow, error) {
	cutoff := time.Now().Add(-gracePeriod)
	tx, err := Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(context.Background()) //nolint

	rows, err := tx.Query(ctx, `
		SELECT id, queue, payload, status::text, attempts, created_at, sent_at
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
		if err := rows.Scan(&r.ID, &r.Queue, &r.Payload, &r.Status, &r.Attempts, &r.CreatedAt, &r.SentAt); err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Bump attempts for the claimed rows so a failing job does not
	// retry forever (the sweeper drops rows past maxAttempts).
	for _, r := range out {
		if _, err := tx.Exec(ctx, `
			UPDATE notification_outbox SET attempts = attempts + 1
			WHERE id = $1::uuid`, r.ID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}
