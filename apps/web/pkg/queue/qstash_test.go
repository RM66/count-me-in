package queue

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// P0: the after-commit publisher (ADR-012). The booking is already
// committed when this runs, so failures are signalled — never thrown —
// and the dedup id (the outbox row id) is what makes the sweeper's
// re-publish safe.

func TestPublishOutboxHeaders(t *testing.T) {
	var gotHeaders http.Header
	var gotPath, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHeaders = r.Header.Clone()
		gotPath = r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		gotBody = string(raw)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	t.Setenv("QSTASH_TOKEN", "test-token")
	t.Setenv("QSTASH_URL", srv.URL)
	t.Setenv("APP_URL", "https://example.com")
	t.Setenv("NODE_ENV", "test")
	t.Setenv("VERCEL_ENV", "")

	payload := json.RawMessage(`{"bookingId":"01930000-0000-7000-8000-0000000000bb","recipient":"organizer"}`)
	if err := PublishOutbox(t.Context(), "booking.created", payload, "row-id-1", "trace-1"); err != nil {
		t.Fatalf("publish to a 200 QStash must succeed, got %v", err)
	}
	if got := gotHeaders.Get("Authorization"); got != "Bearer test-token" {
		t.Errorf("Authorization = %q", got)
	}
	if got := gotHeaders.Get("Upstash-Deduplication-Id"); got != "row-id-1" {
		t.Errorf("Upstash-Deduplication-Id = %q, want the outbox row id", got)
	}
	if got := gotHeaders.Get("Upstash-Trace-Id"); got != "trace-1" {
		t.Errorf("Upstash-Trace-Id = %q", got)
	}
	if got := gotHeaders.Get("Upstash-Retries"); got != "5" {
		t.Errorf("Upstash-Retries = %q, want 5", got)
	}
	if gotBody != string(payload) {
		t.Errorf("published body = %q, want the outbox payload verbatim", gotBody)
	}
	wantPrefix := "/v2/publish/https://example.com/api/jobs/booking.created"
	if gotPath != wantPrefix {
		t.Errorf("publish path = %q, want %q", gotPath, wantPrefix)
	}
}

func TestPublishOutboxDevSkipsWithoutToken(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	t.Setenv("QSTASH_TOKEN", "")
	t.Setenv("QSTASH_URL", srv.URL)
	t.Setenv("APP_URL", "https://example.com")
	t.Setenv("NODE_ENV", "test")
	t.Setenv("VERCEL_ENV", "")

	// Local deliveries would be unreachable anyway (QStash POSTs to
	// APP_URL; localhost is not routable) — skipped with the sentinel so
	// the caller marks the row `skipped` (honest terminal state) instead
	// of `sent`.
	if err := PublishOutbox(t.Context(), "booking.created", json.RawMessage(`{}`), "row-id", "trace"); !errors.Is(err, ErrPublishSkipped) {
		t.Fatalf("dev skip must return ErrPublishSkipped, got %v", err)
	}
	if calls != 0 {
		t.Fatalf("dev skip must not touch HTTP, got %d calls", calls)
	}
}

func TestPublishOutboxProdRequiresToken(t *testing.T) {
	t.Setenv("QSTASH_TOKEN", "")
	t.Setenv("NODE_ENV", "production")
	if err := PublishOutbox(t.Context(), "booking.created", json.RawMessage(`{}`), "row-id", "trace"); err == nil {
		t.Fatal("production publish without QSTASH_TOKEN must fail")
	}
}

func TestPublishOutboxUnreachableIsError(t *testing.T) {
	t.Setenv("QSTASH_TOKEN", "test-token")
	t.Setenv("QSTASH_URL", "http://127.0.0.1:1") // refuses fast
	t.Setenv("APP_URL", "https://example.com")
	t.Setenv("NODE_ENV", "test")
	t.Setenv("VERCEL_ENV", "")

	// The caller (publishOutboxRows) absorbs this — the row stays pending
	// for the sweeper. Here we pin that the error is signalled, not lost.
	if err := PublishOutbox(t.Context(), "booking.created", json.RawMessage(`{}`), "row-id", "trace"); err == nil {
		t.Fatal("unreachable QStash must return an error")
	}
}

func TestPublishOutboxNon2xxIsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	t.Setenv("QSTASH_TOKEN", "test-token")
	t.Setenv("QSTASH_URL", srv.URL)
	t.Setenv("APP_URL", "https://example.com")
	t.Setenv("NODE_ENV", "test")
	t.Setenv("VERCEL_ENV", "")

	if err := PublishOutbox(t.Context(), "booking.created", json.RawMessage(`{}`), "row-id", "trace"); err == nil {
		t.Fatal("QStash 500 must return an error")
	}
}

func TestPublishOutboxRequiresAppURL(t *testing.T) {
	t.Setenv("QSTASH_TOKEN", "test-token")
	t.Setenv("QSTASH_URL", "https://qstash.upstash.io")
	t.Setenv("APP_URL", "")
	t.Setenv("NODE_ENV", "test")
	t.Setenv("VERCEL_ENV", "")

	if err := PublishOutbox(t.Context(), "booking.created", json.RawMessage(`{}`), "row-id", "trace"); err == nil {
		t.Fatal("missing APP_URL must fail (no destination to publish to)")
	}
}
