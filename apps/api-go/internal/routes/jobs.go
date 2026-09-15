package routes

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"

	"api-go/internal/httpx"
	"api-go/internal/jobs"
	"api-go/internal/logx"
)

var errJobsSigningKeysNotSet = errors.New("QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY are not set")

// JobsReceiver — POST /api/jobs/{queue}: the QStash receiver (ADR-012).
// Everything QStash delivers lands here: booking.created and
// booking.cancelled published after the booking transaction commits,
// and the demo.refresh schedule. The only caller is QStash itself, so
// authorization is its per-request signature (upstash-signature,
// verified with the signing keys) rather than a session or ticket —
// and every response body is empty, because the consumer is a queue
// that reads status codes, not copy.
//
// Status semantics are the queue's retry budget:
//   - 200 — delivered, or deliberately completed (recipient unreachable)
//   - 400 — malformed payload; retrying would resend the same bad bytes
//   - 401 — missing/invalid signature
//   - 404 — unknown queue name (e.g. a destination configured for
//     another app)
//   - 500 — handler failure; this is what makes QStash retry
func JobsReceiver(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	queue := httpx.PathParam(r, "/api/jobs/")

	currentSigningKey := os.Getenv("QSTASH_CURRENT_SIGNING_KEY")
	nextSigningKey := os.Getenv("QSTASH_NEXT_SIGNING_KEY")
	if currentSigningKey == "" || nextSigningKey == "" {
		logx.Error(errJobsSigningKeysNotSet, map[string]any{"queue": queue})
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	// The signature covers the exact bytes of the body, so it must be
	// read raw and verified before anything parses it.
	signature := r.Header.Get("upstash-signature")
	if signature == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	body, _ := httpx.ReadBody(r)
	if !jobs.VerifyQStashSignature(body, signature, currentSigningKey, nextSigningKey) {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	// An empty body (the demo-refresh schedule sends no payload) stays
	// nil; a non-empty one must be valid JSON.
	var payload json.RawMessage
	if len(body) > 0 {
		if !json.Valid(body) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		payload = body
	}

	if err := jobs.RunJob(r.Context(), queue, payload); err != nil {
		switch err.(type) {
		case *jobs.UnknownJobQueueError:
			w.WriteHeader(http.StatusNotFound)
		case *jobs.InvalidJobPayloadError:
			w.WriteHeader(http.StatusBadRequest)
		default:
			// Anything else is a handler failure — a 500 so QStash
			// retries the delivery.
			logx.Error(err, map[string]any{"queue": queue})
			w.WriteHeader(http.StatusInternalServerError)
		}
		return
	}
	w.WriteHeader(http.StatusOK)
}
