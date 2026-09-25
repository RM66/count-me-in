package routes

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"countmein/pkg/contracts"
)

// the QStash receiver's status semantics are the queue's
// retry budget (ADR-012): 400 for a malformed payload (no retry), 404
// for a foreign queue, 401 for a bad signature, 500 for a handler
// failure (retry). The signature helper mirrors receiver_test.go in
// pkg/jobs — hand-built so the test anchors the wire contract.

const (
	routesCurrentKey = "routes-sig-current-key-0000000000"
	routesNextKey    = "routes-sig-next-key-00000000000000000"
)

func signQStash(key, body, sub string) string {
	claims := map[string]any{
		"iss":  "Upstash",
		"exp":  time.Now().Add(time.Hour).Unix(),
		"sub":  sub,
		"body": base64.RawURLEncoding.EncodeToString(sha256Sum(body)),
	}
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload, _ := json.Marshal(claims)
	payloadB64 := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(header + "." + payloadB64))
	return header + "." + payloadB64 + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func sha256Sum(s string) []byte {
	sum := sha256.Sum256([]byte(s))
	return sum[:]
}

// expectedSub mirrors the receiver: APP_URL (trimmed) + "/api/jobs/" +
// queue. Tests leave APP_URL unset, so the sub is the bare path.
func expectedSub(queue string) string {
	return strings.TrimRight(os.Getenv("APP_URL"), "/") + "/api/jobs/" + queue
}

func postJobs(t *testing.T, queue, body, signature string) *httptest.ResponseRecorder {
	t.Helper()
	t.Setenv("QSTASH_CURRENT_SIGNING_KEY", routesCurrentKey)
	t.Setenv("QSTASH_NEXT_SIGNING_KEY", routesNextKey)
	r := httptest.NewRequest(http.MethodPost, "/api/jobs/"+queue, strings.NewReader(body))
	if signature != "" {
		r.Header.Set("upstash-signature", signature)
	}
	w := httptest.NewRecorder()
	JobsReceiver(w, r, queue)
	return w
}

func TestJobsReceiverSigningKeysNotSet(t *testing.T) {
	t.Setenv("QSTASH_CURRENT_SIGNING_KEY", "")
	t.Setenv("QSTASH_NEXT_SIGNING_KEY", "")
	r := httptest.NewRequest(http.MethodPost, "/api/jobs/booking.created", nil)
	w := httptest.NewRecorder()
	JobsReceiver(w, r, contracts.QueueBookingCreated)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("missing signing keys must be a 500, got %d", w.Code)
	}
}

func TestJobsReceiverMissingSignature(t *testing.T) {
	w := postJobs(t, contracts.QueueBookingCreated, "{}", "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("missing signature must be a 401, got %d", w.Code)
	}
}

func TestJobsReceiverBadSignature(t *testing.T) {
	w := postJobs(t, contracts.QueueBookingCreated, "{}", "not-a-jwt")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("garbage signature must be a 401, got %d", w.Code)
	}
	sig := signQStash("wrong-key", "{}", expectedSub(contracts.QueueBookingCreated))
	w = postJobs(t, contracts.QueueBookingCreated, "{}", sig)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("signature with a wrong key must be a 401, got %d", w.Code)
	}
}

func TestJobsReceiverUnknownQueue(t *testing.T) {
	body := `{"x":1}`
	w := postJobs(t, "some.foreign.queue", body, signQStash(routesCurrentKey, body, expectedSub("some.foreign.queue")))
	if w.Code != http.StatusNotFound {
		t.Fatalf("unknown queue must be a 404 (no retry), got %d", w.Code)
	}
}

func TestJobsReceiverInvalidPayload(t *testing.T) {
	// Valid signature, invalid payload → 400, QStash does not retry.
	body := `{"bookingId":"not-a-uuid"}`
	w := postJobs(t, contracts.QueueBookingCreated, body, signQStash(routesCurrentKey, body, expectedSub(contracts.QueueBookingCreated)))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("malformed payload must be a 400 (no retry), got %d", w.Code)
	}
}

func TestJobsReceiverInvalidJSON(t *testing.T) {
	body := `{"bookingId":`
	w := postJobs(t, contracts.QueueBookingCreated, body, signQStash(routesCurrentKey, body, expectedSub(contracts.QueueBookingCreated)))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("broken JSON must be a 400, got %d", w.Code)
	}
}

func TestJobsReceiverHandlerFailureIs500(t *testing.T) {
	// A well-formed booking.created payload reaches the handler; with
	// the job env unconfigured the handler fails → 500, which is what
	// makes QStash retry (the opposite of the 400 above).
	t.Setenv("TELEGRAM_BOT_TOKEN", "")
	t.Setenv("APP_URL", "")
	body := `{"bookingId":"01930000-0000-7000-8000-0000000000bb","recipient":"organizer"}`
	w := postJobs(t, contracts.QueueBookingCreated, body, signQStash(routesCurrentKey, body, expectedSub(contracts.QueueBookingCreated)))
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("handler failure must be a 500 (QStash retries), got %d", w.Code)
	}
}

func TestJobsReceiverEmptyBodyIsNotJSON(t *testing.T) {
	// An empty body is valid for the schedule queues; for booking
	// queues it must still be a 400 — but the signature check runs on
	// the raw bytes, so sign the empty body.
	w := postJobs(t, contracts.QueueBookingCreated, "", signQStash(routesCurrentKey, "", expectedSub(contracts.QueueBookingCreated)))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("empty body for a booking queue must be a 400, got %d", w.Code)
	}
}
