package routes

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"countmein/pkg/config"
	"countmein/pkg/httpx"
	"countmein/pkg/jobs"
	"countmein/pkg/logx"
	"countmein/pkg/redis"
)

var errJobsSigningKeysNotSet = errors.New("QSTASH_CURRENT_SIGNING_KEY is not set")

// replayTTL — how long a successfully processed delivery's signature is
// remembered. Short-lived relative to the consumer idempotency window
// (24h): it only needs to cover the signature's exp horizon, after
// which the verifier rejects the replay anyway. Only successes are
// recorded — a failed delivery (500) must stay retryable, so QStash's
// at-least-once redelivery still reprocesses it.
const replayTTL = time.Hour

// replayKey identifies a delivery by the hash of its signature (the
// signature covers the exact body bytes, so equal signatures mean equal
// deliveries). Hashed, not raw: the signature is a bearer credential
// for the exp window and must not land verbatim in Redis keys/logs.
func replayKey(signature string) string {
	sum := sha256.Sum256([]byte(signature))
	return "job:replay:" + hex.EncodeToString(sum[:])
}

// seenReplay reports whether this exact delivery already succeeded.
// Fail-open (ADR-019): without Redis, or on a Redis error, the delivery
// proceeds normally — the consumer idempotency guard is the second net.
func seenReplay(ctx context.Context, key string) bool {
	if !config.RedisConfigured() {
		return false
	}
	n, err := redis.Client().Exists(ctx, key).Result()
	if err != nil {
		logx.WarnEvery(5*time.Minute, "job replay check failed — failing open", map[string]any{
			"scope": "job-replay", "error": err.Error(),
		})
		return false
	}
	return n > 0
}

// markReplayed records a successful delivery so a replayed signature
// completes without reprocessing. Best-effort: a failure only means the
// next replay reprocesses (still guarded by consumer idempotency).
func markReplayed(ctx context.Context, key string) {
	if !config.RedisConfigured() {
		return
	}
	if err := redis.Client().Set(ctx, key, "1", replayTTL).Err(); err != nil {
		logx.WarnEvery(5*time.Minute, "job replay record failed", map[string]any{
			"scope": "job-replay", "error": err.Error(),
		})
	}
}

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
//
// queue comes from the generated router (gen.RunJobParamsQueue).
func JobsReceiver(w http.ResponseWriter, r *http.Request, queue string) {
	// Only the current signing key is required. The next key exists
	// solely for QStash's key-rotation window and is legitimately empty
	// outside it — requiring it non-empty would 500 every delivery
	// (and burn QStash's retry budget) for no reason. The verifier
	// simply tries the empty key and fails to match, which is correct.
	currentSigningKey := os.Getenv("QSTASH_CURRENT_SIGNING_KEY")
	if currentSigningKey == "" {
		logx.Error(errJobsSigningKeysNotSet, map[string]any{"queue": queue})
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	nextSigningKey := os.Getenv("QSTASH_NEXT_SIGNING_KEY")

	// The signature covers the exact bytes of the body, so it must be
	// read raw and verified before anything parses it.
	signature := r.Header.Get("upstash-signature")
	if signature == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	body, ok := httpx.ReadBodyOr413(w, r)
	if !ok {
		return
	}
	// Destination binding: the sub claim must name this deployment's
	// receiver URL — the signing keys are account-scoped, so a delivery
	// signed for another destination in the same account must not
	// verify here.
	expectedSub := strings.TrimRight(os.Getenv("APP_URL"), "/") + "/api/jobs/" + queue
	if !jobs.VerifyQStashSignature(body, signature, currentSigningKey, nextSigningKey, expectedSub) {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	// Replay suppression: a captured delivery replayed within the exp
	// window would otherwise re-run non-idempotent queues (sweep,
	// demo-refresh). Booking queues are additionally guarded by the
	// consumer idempotency key; this cache is the outer net for all
	// queues. Only past successes are recorded, so failed deliveries
	// stay retryable.
	rkey := replayKey(signature)
	if seenReplay(r.Context(), rkey) {
		logx.Info("replayed delivery — completing without reprocessing", map[string]any{
			"queue": queue,
		})
		w.WriteHeader(http.StatusOK)
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

	traceID := jobs.TraceIDFromRequest(r)
	if err := jobs.RunJob(r.Context(), queue, payload, traceID); err != nil {
		// errors.As, not a type switch: a wrapped error must not slip
		// past the mapping into a bare 500 (which would make QStash
		// retry a delivery that can never succeed).
		var unknown *jobs.UnknownJobQueueError
		var invalid *jobs.InvalidJobPayloadError
		switch {
		case errors.As(err, &unknown):
			w.WriteHeader(http.StatusNotFound)
		case errors.As(err, &invalid):
			w.WriteHeader(http.StatusBadRequest)
		default:
			// Anything else is a handler failure — a 500 so QStash
			// retries the delivery.
			fields := map[string]any{"queue": queue}
			if traceID != "" {
				fields["traceId"] = traceID
			}
			logx.Error(err, fields)
			w.WriteHeader(http.StatusInternalServerError)
		}
		return
	}
	markReplayed(r.Context(), rkey)
	w.WriteHeader(http.StatusOK)
}
