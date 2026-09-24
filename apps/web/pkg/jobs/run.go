package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/contracts"
	"countmein/pkg/logx"

	"github.com/google/uuid"
)

// Job dispatch — the one place a QStash delivery becomes a handler call.
// Owns the two policies every job shares:
//
//   - Payload validation: a malformed body gets a 400-class outcome
//     (non-retryable — QStash would burn its budget re-sending the
//     same bad bytes), so parsing happens here, before any handler runs.
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

// checkPayload validates one QStash delivery body without touching the
// network or the database: UnknownJobQueueError for a foreign queue name,
// InvalidJobPayloadError for a malformed payload, nil when the delivery
// may proceed. The schedule-driven queues (demo.refresh, outbox.sweep)
// send no payload, so any body — including an empty one — is valid for
// them. Extracted so tests pin the 400/404 boundary without invoking
// handlers (which would reseed the demo DB or sweep the outbox as a side
// effect).
func checkPayload(queue string, body json.RawMessage) error {
	switch queue {
	case contracts.QueueBookingCreated:
		var job gen.BookingCreatedJob
		if err := parsePayload(body, &job); err != nil {
			return err
		}
		// bookingId is a uuid on the wire (bookingCreatedJob schema);
		// a malformed id must be a 400, not a 500 — otherwise QStash
		// burns all retries on bytes that can never succeed.
		if !validBookingID(contracts.UUIDString(job.BookingID)) || !validRecipient(string(job.Recipient)) {
			return &InvalidJobPayloadError{Queue: queue}
		}
		return nil
	case contracts.QueueBookingCancelled:
		var job gen.BookingCancelledJob
		if err := parsePayload(body, &job); err != nil {
			return err
		}
		if !validBookingID(contracts.UUIDString(job.BookingID)) ||
			(job.CancelledBy != gen.CancelActorGuest && job.CancelledBy != gen.CancelActorOrganizer) {
			return &InvalidJobPayloadError{Queue: queue}
		}
		return nil
	case contracts.QueueDemoRefresh, contracts.QueueOutboxSweep:
		return nil
	default:
		return &UnknownJobQueueError{Queue: queue}
	}
}

// RunJob validates and runs one QStash delivery. body is the parsed
// JSON of the request, or nil for an empty body (the demo-refresh
// schedule sends no payload). Returns UnknownJobQueueError for a
// foreign queue name and InvalidJobPayloadError for a malformed
// payload; any other error is a handler failure the route answers 500
// with, which is what makes QStash retry.
func RunJob(ctx context.Context, queue string, body json.RawMessage, traceID string) error {
	if err := checkPayload(queue, body); err != nil {
		return err
	}
	switch queue {
	case contracts.QueueBookingCreated:
		var job gen.BookingCreatedJob
		// Already validated by checkPayload above — a failure here is
		// unreachable (same bytes), but never proceed with a zero job.
		if err := parsePayload(body, &job); err != nil {
			return err
		}
		env, err := ReadEnv()
		if err != nil {
			return err
		}
		return withRetryPolicy(queue, traceID, func() error {
			return HandleBookingCreated(ctx, env, job, traceID)
		})
	case contracts.QueueBookingCancelled:
		var job gen.BookingCancelledJob
		if err := parsePayload(body, &job); err != nil {
			return err
		}
		env, err := ReadEnv()
		if err != nil {
			return err
		}
		return withRetryPolicy(queue, traceID, func() error {
			return HandleBookingCancelled(ctx, env, job, traceID)
		})
	case contracts.QueueDemoRefresh:
		// A failure escapes as a 500 so QStash retries (Sentry in the
		// TS version; structured log here).
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

// withRetryPolicy absorbs the one failure that must never be retried:
// letting it reach QStash would spend the retry budget and end in a
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
	return err
}

// parsePayload mirrors the Zod safeParse: absent body fails the
// object schemas (both booking queues require their fields), and a
// present body must be a JSON object of the right shape.
func parsePayload(body json.RawMessage, dst any) error {
	if len(body) == 0 {
		return &InvalidJobPayloadError{}
	}
	if err := json.Unmarshal(body, dst); err != nil {
		return &InvalidJobPayloadError{}
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
