package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/contracts"
)

// job dispatch semantics — the route's status codes are QStash's
// retry budget (ADR-012). A malformed payload must be a 400-class
// InvalidJobPayloadError (no retry: QStash would re-send the same bad
// bytes), an unknown queue a 404-class UnknownJobQueueError, and
// TelegramUnreachableError must be absorbed (a recipient who never
// pressed Start can never be messaged — retrying burns the budget).

const testBookingID = "01930000-0000-7000-8000-0000000000bb"

func TestRunJobUnknownQueue(t *testing.T) {
	err := RunJob(context.Background(), "some.foreign.queue", nil, "")
	var unknown *UnknownJobQueueError
	if !errors.As(err, &unknown) {
		t.Fatalf("unknown queue must be UnknownJobQueueError, got %T: %v", err, err)
	}
	if unknown.Queue != "some.foreign.queue" {
		t.Errorf("queue = %q", unknown.Queue)
	}
}

func TestRunJobBookingCreatedInvalidPayloads(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"empty body", ""},
		{"broken json", `{"bookingId":`},
		{"empty object (missing fields)", `{}`},
		{"non-uuid bookingId", `{"bookingId":"not-a-uuid","recipient":"organizer"}`},
		{"unknown recipient", `{"bookingId":"` + testBookingID + `","recipient":"nobody"}`},
		{"missing recipient", `{"bookingId":"` + testBookingID + `"}`},
	}
	for _, c := range cases {
		err := RunJob(context.Background(), contracts.QueueBookingCreated, []byte(c.body), "")
		var invalid *InvalidJobPayloadError
		if !errors.As(err, &invalid) {
			t.Errorf("%s: must be InvalidJobPayloadError, got %T: %v", c.name, err, err)
		}
	}
}

func TestRunJobBookingCancelledInvalidPayloads(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"empty body", ""},
		{"broken json", `{"bookingId":`},
		{"non-uuid bookingId", `{"bookingId":"nope","cancelledBy":"guest"}`},
		{"unknown cancelledBy", `{"bookingId":"` + testBookingID + `","cancelledBy":"system"}`},
		{"missing cancelledBy", `{"bookingId":"` + testBookingID + `"}`},
	}
	for _, c := range cases {
		err := RunJob(context.Background(), contracts.QueueBookingCancelled, []byte(c.body), "")
		var invalid *InvalidJobPayloadError
		if !errors.As(err, &invalid) {
			t.Errorf("%s: must be InvalidJobPayloadError, got %T: %v", c.name, err, err)
		}
	}
}

// A well-formed payload passes parse + shape validation and reaches the
// env check — the returned error is the env error, NOT
// InvalidJobPayloadError. This pins the boundary: payload problems are
// 400-class, configuration problems are 500-class (QStash retries).
func TestRunJobValidPayloadReachesEnvCheck(t *testing.T) {
	t.Setenv("TELEGRAM_BOT_TOKEN", "")
	t.Setenv("APP_URL", "")

	created := RunJob(context.Background(), contracts.QueueBookingCreated,
		[]byte(`{"bookingId":"`+testBookingID+`","recipient":"organizer"}`), "")
	var invalid *InvalidJobPayloadError
	if errors.As(created, &invalid) {
		t.Fatalf("valid booking.created payload must not be InvalidJobPayloadError")
	}
	if created == nil || !strings.Contains(created.Error(), "jobs env is not configured") {
		t.Fatalf("expected the env error, got %v", created)
	}

	cancelled := RunJob(context.Background(), contracts.QueueBookingCancelled,
		[]byte(`{"bookingId":"`+testBookingID+`","cancelledBy":"guest"}`), "")
	if errors.As(cancelled, &invalid) {
		t.Fatalf("valid booking.cancelled payload must not be InvalidJobPayloadError")
	}
	if cancelled == nil || !strings.Contains(cancelled.Error(), "jobs env is not configured") {
		t.Fatalf("expected the env error, got %v", cancelled)
	}
}

// Empty body is VALID for the schedule-driven queues (demo.refresh and
// the outbox sweep send no payload) and INVALID for the booking queues.
// Pinned against checkPayload — the pure validator — so the test never
// invokes handlers (which would reseed the demo DB / sweep the outbox as
// a side effect) and never depends on panic-message substrings.
func TestCheckPayloadScheduleQueuesAcceptEmptyBody(t *testing.T) {
	for _, queue := range []string{contracts.QueueDemoRefresh, contracts.QueueOutboxSweep} {
		for _, body := range []string{"", `{}`, `{"anything":1}`} {
			var raw json.RawMessage
			if body != "" {
				raw = json.RawMessage(body)
			}
			if err := checkPayload(queue, raw); err != nil {
				t.Errorf("%s with body %q must be valid, got %T: %v", queue, body, err, err)
			}
		}
	}
	for _, queue := range []string{contracts.QueueBookingCreated, contracts.QueueBookingCancelled} {
		if err := checkPayload(queue, nil); err == nil {
			t.Errorf("%s with an empty body must be invalid", queue)
		} else {
			var invalid *InvalidJobPayloadError
			if !errors.As(err, &invalid) {
				t.Errorf("%s with an empty body must be InvalidJobPayloadError, got %T: %v", queue, err, err)
			}
		}
	}
}

func TestCheckPayloadUnknownQueue(t *testing.T) {
	err := checkPayload("some.foreign.queue", nil)
	var unknown *UnknownJobQueueError
	if !errors.As(err, &unknown) {
		t.Fatalf("unknown queue must be UnknownJobQueueError, got %T: %v", err, err)
	}
}

// ── withRetryPolicy ───────────────────────────────────────────────────────────

func TestWithRetryPolicyAbsorbsUnreachable(t *testing.T) {
	// 403 / "chat not found" → the delivery is completed with a log, not
	// retried — the recipient can never become reachable.
	err := withRetryPolicy(contracts.QueueBookingCreated, "trace-1", func() error {
		return &TelegramUnreachableError{ChatID: "123", Description: "Forbidden: bot was blocked by the user"}
	})
	if err != nil {
		t.Fatalf("unreachable recipient must be absorbed, got %v", err)
	}
}

func TestWithRetryPolicyPropagatesTransient(t *testing.T) {
	transient := &TelegramTransientError{Message: "Telegram 429: Too Many Requests"}
	err := withRetryPolicy(contracts.QueueBookingCreated, "trace-2", func() error { return transient })
	if !errors.Is(err, transient) {
		t.Fatalf("429/5xx/network must propagate for a 500 → QStash retries, got %v", err)
	}
	plain := errors.New("some handler failure")
	if err := withRetryPolicy(contracts.QueueBookingCreated, "trace-3", func() error { return plain }); !errors.Is(err, plain) {
		t.Fatalf("ordinary handler errors must propagate, got %v", err)
	}
}

func TestWithRetryPolicySuccess(t *testing.T) {
	if err := withRetryPolicy(contracts.QueueBookingCreated, "trace-4", func() error { return nil }); err != nil {
		t.Fatalf("success must stay success, got %v", err)
	}
}

// ── payload shape helpers ─────────────────────────────────────────────────────

func TestValidBookingID(t *testing.T) {
	if !validBookingID(testBookingID) {
		t.Error("uuid bookingId must be valid")
	}
	for _, bad := range []string{"", "not-a-uuid", testBookingID + "x"} {
		if validBookingID(bad) {
			t.Errorf("validBookingID(%q) must be false", bad)
		}
	}
}

func TestValidRecipient(t *testing.T) {
	for _, good := range []string{string(gen.NotificationRecipientOrganizer), string(gen.NotificationRecipientGuest)} {
		if !validRecipient(good) {
			t.Errorf("validRecipient(%q) must be true", good)
		}
	}
	for _, bad := range []string{"", "nobody", "ORGANIZER"} {
		if validRecipient(bad) {
			t.Errorf("validRecipient(%q) must be false", bad)
		}
	}
}
