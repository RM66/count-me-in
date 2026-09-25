package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/config"
	"countmein/pkg/contracts"
	"countmein/pkg/logx"
	"countmein/pkg/redis"

	"github.com/google/uuid"
)

// Job dispatch — the one place a QStash delivery becomes a handler call.
// Owns the policies every job shares:
//
//   - Payload validation: a malformed body gets a 400-class outcome
//     (non-retryable — QStash would burn its budget re-sending the
//     same bad bytes), so parsing happens here, before any handler runs.
//   - Consumer idempotency: the payload's outboxId is SET-NX'd in Redis
//     before dispatch, so a duplicate delivery — a sweeper re-publish
//     outside QStash's dedup window, a redelivery after a lost
//     response — cannot double-notify the same recipient. A *failed*
//     dispatch releases the claim (runClaimed), so QStash's retry after
//     a Telegram timeout is processed again instead of being answered
//     as a duplicate: the guarantee is at-least-once with duplicate
//     suppression on success, never a silent loss. Fails open on a
//     Redis outage (the delivery proceeds), same stance as the rate
//     limiter.
//   - Retry classification: a handler error is returned for the route
//     to answer 500 with, which is what makes QStash retry — except
//     TelegramUnreachableError, which is absorbed with a log: a
//     recipient who never pressed Start on the bot cannot be messaged
//     now or in five minutes, so the delivery is completed rather
//     than retried.

// UnknownJobQueueError — the {queue} path segment names no known queue.
type UnknownJobQueueError struct {
	Queue string
}

func (e *UnknownJobQueueError) Error() string {
	return fmt.Sprintf("unknown job queue %q", e.Queue)
}

// InvalidJobPayloadError — the delivery body does not parse / does
// not match the queue's schema.
type InvalidJobPayloadError struct {
	Queue string
}

func (e *InvalidJobPayloadError) Error() string {
	return fmt.Sprintf("invalid payload for job queue %q", e.Queue)
}

// parsedJob is the outcome of validating one delivery: the typed
// payload for the booking queues, nil for the schedule-driven queues
// (demo.refresh, outbox.sweep send no payload). Parsing happens exactly
// once — the dispatch switch consumes this value directly.
type parsedJob struct {
	bookingCreated   *gen.BookingCreatedJob
	bookingCancelled *gen.BookingCancelledJob
}

// parseJob validates one QStash delivery body without touching the
// network or the database: UnknownJobQueueError for a foreign queue
// name, InvalidJobPayloadError for a malformed payload, nil error when
// the delivery may proceed. The schedule-driven queues (demo.refresh,
// outbox.sweep) send no payload, so any body — including an empty
// one — is valid for them. Extracted so tests pin the 400/404 boundary
// without invoking handlers (which would reseed the demo DB or sweep
// the outbox as a side effect).
func parseJob(queue string, body json.RawMessage) (parsedJob, error) {
	switch queue {
	case contracts.QueueBookingCreated:
		var job gen.BookingCreatedJob
		if err := parsePayload(queue, body, &job); err != nil {
			return parsedJob{}, err
		}
		// bookingId/outboxId are uuids on the wire (bookingCreatedJob
		// schema); a malformed id must be a 400, not a 500 — otherwise
		// QStash burns all retries on bytes that can never succeed.
		if !validBookingID(contracts.UUIDString(job.BookingID)) ||
			!validBookingID(contracts.UUIDString(job.OutboxID)) ||
			!validRecipient(string(job.Recipient)) {
			return parsedJob{}, &InvalidJobPayloadError{Queue: queue}
		}
		return parsedJob{bookingCreated: &job}, nil
	case contracts.QueueBookingCancelled:
		var job gen.BookingCancelledJob
		if err := parsePayload(queue, body, &job); err != nil {
			return parsedJob{}, err
		}
		if !validBookingID(contracts.UUIDString(job.BookingID)) ||
			!validBookingID(contracts.UUIDString(job.OutboxID)) ||
			(job.CancelledBy != gen.CancelActorGuest && job.CancelledBy != gen.CancelActorOrganizer) {
			return parsedJob{}, &InvalidJobPayloadError{Queue: queue}
		}
		return parsedJob{bookingCancelled: &job}, nil
	case contracts.QueueDemoRefresh, contracts.QueueOutboxSweep:
		return parsedJob{}, nil
	default:
		return parsedJob{}, &UnknownJobQueueError{Queue: queue}
	}
}

// idempotencyTTL — longer than QStash's retry horizon (5 retries with
// exponential backoff tops out well under a day), so a redelivery of
// the same outbox row inside the window is always recognized.
const idempotencyTTL = 24 * time.Hour

// processedKey — the consumer idempotency key for one outbox row.
func processedKey(outboxID string) string { return "job:processed:" + outboxID }

// claimDelivery SET-NX's the outbox id: true means this delivery is
// the first for that row and the handler may send. A lost race (or a
// Redis error) fails open — the delivery proceeds — matching the
// ADR-019 stance: an idempotency outage must not block notifications,
// and the worst case is a rare duplicate message, never a lost one.
func claimDelivery(ctx context.Context, outboxID string) bool {
	if !config.RedisConfigured() {
		return true
	}
	ok, err := redis.Client().SetNX(ctx, processedKey(outboxID), "1", idempotencyTTL).Result()
	if err != nil {
		logx.WarnEvery(5*time.Minute, "job idempotency check failed — failing open", map[string]any{
			"scope": "job-idempotency", "error": err.Error(),
		})
		return true
	}
	return ok
}

// releaseDelivery drops the claim of a delivery whose send failed
// retryably, so QStash's retry (or the sweeper's re-publish) reaches
// the handler again instead of being suppressed as a duplicate. The
// outbox row was already marked `sent` by its publisher, so this Redis
// key is the only place the retry is tracked.
//
// The trade-off is deliberate: a transport failure is ambiguous
// (Telegram might have processed the request before the response was
// lost), so a released retry can duplicate a message. At-least-once is
// the product rule — a rare duplicate beats a silently lost
// notification, which is what claiming without releasing produces.
//
// Best-effort: if the DEL fails the retry is skipped as a duplicate
// (at-most-once for that row) rather than risking a double send, and
// the logged failure is the incident signal.
func releaseDelivery(ctx context.Context, outboxID string) {
	if !config.RedisConfigured() {
		return
	}
	if err := redis.Client().Del(ctx, processedKey(outboxID)).Err(); err != nil {
		logx.WarnEvery(5*time.Minute, "job idempotency release failed — the retry will be suppressed", map[string]any{
			"scope": "job-idempotency", "outboxId": outboxID, "error": err.Error(),
		})
	}
}

// runClaimed wraps one booking-queue dispatch in the consumer
// idempotency guard: claim → send → release on a retryable failure.
// Terminal outcomes that withRetryPolicy absorbs (unreachable chat,
// rejected content) keep the claim — those deliveries are complete and
// must never be re-sent.
func runClaimed(ctx context.Context, queue, traceID, outboxID string, run func() error) error {
	if !claimDelivery(ctx, outboxID) {
		logx.Info("duplicate delivery — completing without sending", map[string]any{
			"queue": queue, "outboxId": outboxID, "traceId": traceID,
		})
		return nil
	}
	err := withRetryPolicy(queue, traceID, run)
	if err != nil {
		releaseDelivery(ctx, outboxID)
	}
	return err
}

// RunJob validates and runs one QStash delivery. body is the parsed
// JSON of the request, or nil for an empty body (the demo-refresh
// schedule sends no payload). Returns UnknownJobQueueError for a
// foreign queue name and InvalidJobPayloadError for a malformed
// payload; any other error is a handler failure the route answers 500
// with, which is what makes QStash retry.
func RunJob(ctx context.Context, queue string, body json.RawMessage, traceID string) error {
	job, err := parseJob(queue, body)
	if err != nil {
		return err
	}
	switch queue {
	case contracts.QueueBookingCreated:
		env, err := ReadEnv()
		if err != nil {
			return err
		}
		outboxID := contracts.UUIDString(job.bookingCreated.OutboxID)
		return runClaimed(ctx, queue, traceID, outboxID, func() error {
			return HandleBookingCreated(ctx, env, *job.bookingCreated, traceID)
		})
	case contracts.QueueBookingCancelled:
		env, err := ReadEnv()
		if err != nil {
			return err
		}
		outboxID := contracts.UUIDString(job.bookingCancelled.OutboxID)
		return runClaimed(ctx, queue, traceID, outboxID, func() error {
			return HandleBookingCancelled(ctx, env, *job.bookingCancelled, traceID)
		})
	case contracts.QueueDemoRefresh:
		// A failure escapes as a 500 so QStash retries.
		if err := HandleDemoRefresh(ctx); err != nil {
			logx.Error(err, map[string]any{"queue": queue})
			return err
		}
		return nil
	case contracts.QueueOutboxSweep:
		// Outbox sweeper: re-publishes
		// pending notification rows that the inline publish missed.
		// A failure escapes as a 500 so QStash retries the sweep.
		if err := HandleOutboxSweep(ctx); err != nil {
			logx.Error(err, map[string]any{"queue": queue})
			return err
		}
		return nil
	default:
		return &UnknownJobQueueError{Queue: queue}
	}
}

// withRetryPolicy absorbs the failures that must never be retried:
// letting them reach QStash would spend the retry budget and end in a
// dropped message that reads like an outage. The guest's on-screen
// success page, which already carries the management link, is the
// designed fallback.
func withRetryPolicy(queue, traceID string, run func() error) error {
	err := run()
	if err == nil {
		return nil
	}
	var unreachable *TelegramUnreachableError
	if errors.As(err, &unreachable) {
		fields := map[string]any{
			"queue": queue,
			"error": err.Error(),
		}
		if traceID != "" {
			fields["traceId"] = traceID
		}
		logx.Info("recipient unreachable — completing without retry", fields)
		return nil
	}
	var terminal *TelegramTerminalError
	if errors.As(err, &terminal) {
		fields := map[string]any{
			"queue": queue,
			"error": err.Error(),
		}
		if traceID != "" {
			fields["traceId"] = traceID
		}
		logx.Info("message content rejected — completing without retry", fields)
		return nil
	}
	return err
}

// parsePayload mirrors the Zod safeParse: absent body fails the
// object schemas (both booking queues require their fields), and a
// present body must be a JSON object of the right shape. The queue
// name rides along so the error names what failed.
func parsePayload(queue string, body json.RawMessage, dst any) error {
	if len(body) == 0 {
		return &InvalidJobPayloadError{Queue: queue}
	}
	if err := json.Unmarshal(body, dst); err != nil {
		return &InvalidJobPayloadError{Queue: queue}
	}
	return nil
}

func validRecipient(v string) bool {
	return v == string(gen.NotificationRecipientOrganizer) || v == string(gen.NotificationRecipientGuest)
}

func validBookingID(v string) bool {
	_, err := uuid.Parse(v)
	return err == nil
}
