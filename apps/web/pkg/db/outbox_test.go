package db

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// the rows the booking transaction writes are the
// publisher's contract — pending until the inline publish or the sweeper
// marks them sent, terminal when past the retry budget, invisible to the
// sweeper once sent/failed. Uses the shared requirePostgres helper (Fatal
// in CI, Skip locally without a DB).
//
// The outbox table is shared: these tests run against the same dev/test
// database as the app, so a sweep may claim ambient pending rows (bumping
// their `attempts` — SweepOutbox never changes a status) and retention may
// delete ambient `sent` rows (their retention window has passed; the trace
// id lives in logs, not the table). Both are the production semantics being
// tested, not corruption.

// sweepBatchLimit is deliberately far above any plausible ambient backlog:
// SweepOutbox returns the OLDEST pending rows first, so a tight limit would
// make the assertion depend on what other runs left in the shared table.
const sweepBatchLimit = 1000

func enqueueCommitted(t *testing.T, queue, payload, traceID string) OutboxRow {
	t.Helper()
	ctx := context.Background()
	tx, err := Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// Rollback is a no-op after Commit; keeps the tx from leaking on failure.
	defer tx.Rollback(context.Background()) //nolint
	row, err := EnqueueOutbox(ctx, tx, queue, map[string]string{"bookingId": payload}, traceID)
	if err != nil {
		t.Fatalf("EnqueueOutbox: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit outbox row: %v", err)
	}
	t.Cleanup(func() {
		_, _ = Pool().Exec(context.Background(),
			`DELETE FROM notification_outbox WHERE id = $1::uuid`, row.ID)
	})
	return row
}

func outboxStatus(t *testing.T, id string) string {
	t.Helper()
	var status string
	if err := Pool().QueryRow(context.Background(),
		`SELECT status::text FROM notification_outbox WHERE id = $1::uuid`, id).Scan(&status); err != nil {
		t.Fatal(err)
	}
	return status
}

func TestOutboxSentRoundTrip(t *testing.T) {
	requirePostgres(t)
	bookingID := uuid.Must(uuid.NewV7()).String()
	row := enqueueCommitted(t, "booking.created", bookingID, "trace-1")

	if got := outboxStatus(t, row.ID); got != "pending" {
		t.Fatalf("fresh outbox row status = %q, want pending", got)
	}
	if err := MarkOutboxSent(context.Background(), row.ID); err != nil {
		t.Fatalf("MarkOutboxSent: %v", err)
	}
	if got := outboxStatus(t, row.ID); got != "sent" {
		t.Fatalf("after mark-sent status = %q, want sent", got)
	}
	// Idempotent: a second mark (inline publish racing the sweeper) is a
	// no-op, not an error — the WHERE status='pending' matches no row.
	if err := MarkOutboxSent(context.Background(), row.ID); err != nil {
		t.Fatalf("second MarkOutboxSent must be a no-op, got %v", err)
	}
}

func TestOutboxFailedIsTerminal(t *testing.T) {
	requirePostgres(t)
	bookingID := uuid.Must(uuid.NewV7()).String()
	row := enqueueCommitted(t, "booking.created", bookingID, "trace-2")

	if err := MarkOutboxFailed(context.Background(), row.ID); err != nil {
		t.Fatalf("MarkOutboxFailed: %v", err)
	}
	if got := outboxStatus(t, row.ID); got != "failed" {
		t.Fatalf("after mark-failed status = %q, want failed", got)
	}
	// Terminal rows never match the sweeper's pending filter.
	rows, err := SweepOutbox(context.Background(), -time.Minute, sweepBatchLimit)
	if err != nil {
		t.Fatalf("SweepOutbox: %v", err)
	}
	for _, r := range rows {
		if r.ID == row.ID {
			t.Fatalf("failed row %s must not be swept", row.ID)
		}
	}
}

func TestSweepOutboxClaimsPendingAndBumpsAttempts(t *testing.T) {
	requirePostgres(t)
	bookingID := uuid.Must(uuid.NewV7()).String()
	row := enqueueCommitted(t, "booking.cancelled", bookingID, "trace-3")

	// Negative grace puts the cutoff in the future so the just-written
	// row qualifies without sleeping for the real 30s grace period.
	rows, err := SweepOutbox(context.Background(), -time.Minute, sweepBatchLimit)
	if err != nil {
		t.Fatalf("SweepOutbox: %v", err)
	}
	var found *OutboxRow
	for i, r := range rows {
		if r.ID == row.ID {
			found = &rows[i]
			break
		}
	}
	if found == nil {
		t.Fatalf("pending row %s was not swept", row.ID)
	}
	if found.Queue != "booking.cancelled" || found.TraceID != "trace-3" {
		t.Errorf("swept row = %+v, want queue/trace preserved", found)
	}
	// SweepOutbox returns the pre-claim snapshot — the attempts bump is
	// only visible when re-read: the UPDATE runs inside the claim
	// transaction after the SELECT.
	var attempts int
	if err := Pool().QueryRow(context.Background(),
		`SELECT attempts FROM notification_outbox WHERE id = $1::uuid`, row.ID).Scan(&attempts); err != nil {
		t.Fatal(err)
	}
	if attempts < 1 {
		t.Errorf("swept row attempts = %d, want >= 1 (claim bump)", attempts)
	}
}

func TestOutboxBacklogAndRetention(t *testing.T) {
	requirePostgres(t)
	bookingID := uuid.Must(uuid.NewV7()).String()
	row := enqueueCommitted(t, "booking.created", bookingID, "trace-4")

	pending, age, err := OutboxBacklog(context.Background())
	if err != nil {
		t.Fatalf("OutboxBacklog: %v", err)
	}
	if pending < 1 {
		t.Fatalf("backlog pending = %d, want >= 1", pending)
	}
	// The age is time.Since(DB now): the database and test clocks may
	// disagree by milliseconds, so only a wildly negative age is wrong.
	if age < -5*time.Second {
		t.Errorf("backlog oldest age = %v, want >= ~0", age)
	}

	if err := MarkOutboxSent(context.Background(), row.ID); err != nil {
		t.Fatal(err)
	}
	// Retention deletes sent rows older than the cutoff — with a future
	// cutoff the just-sent row qualifies. Other `sent` rows past the window
	// go with it: that is the retention contract (see the file comment).
	deleted, err := DeleteSentOutboxBefore(context.Background(), time.Now().Add(time.Minute))
	if err != nil {
		t.Fatalf("DeleteSentOutboxBefore: %v", err)
	}
	if deleted < 1 {
		t.Fatalf("retention deleted = %d, want >= 1", deleted)
	}
}
