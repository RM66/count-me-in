package httpx

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"countmein/pkg/validation"
)

// The response-writing plumbing: Recover's headers + panic→500,
// Response.Write's branches, the invalid-body/issue renderers, and
// ReadBodyOr413's size bound. These are the seams every route handler
// sits on, so their contracts are pinned here.

// failingReader — a request body whose Read always errors, to drive
// ReadBodyOr413's read-failure branch.
type failingReader struct{}

func (failingReader) Read([]byte) (int, error) { return 0, errors.New("boom") }

func TestRecoverSetsHeaders(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/x", nil)
	Recover(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Errorf("status = %d, want 204", rec.Code)
	}
	for header, want := range map[string]string{
		"Vary":                      "Accept-Language",
		"X-Robots-Tag":              "noindex",
		"Cache-Control":             "no-store",
		"X-Content-Type-Options":    "nosniff",
		"X-Frame-Options":           "DENY",
		"Referrer-Policy":           "strict-origin-when-cross-origin",
		"Permissions-Policy":        "camera=(), microphone=(), geolocation=()",
		"Strict-Transport-Security": "max-age=31536000; includeSubDomains",
	} {
		if got := rec.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
}

func TestRecoverPanicsAnswer500(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/x", nil)
	Recover(func(w http.ResponseWriter, r *http.Request) {
		panic("kaboom")
	})(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("panic must be answered with 500, got %d", rec.Code)
	}
}

func TestResponseWrite(t *testing.T) {
	t.Run("nil receiver is a no-op", func(t *testing.T) {
		rec := httptest.NewRecorder()
		var resp *Response
		resp.Write(rec) // must not panic
		if rec.Code != http.StatusOK {
			t.Errorf("untouched recorder code = %d, want 200", rec.Code)
		}
	})
	t.Run("nil body writes only the status", func(t *testing.T) {
		rec := httptest.NewRecorder()
		Empty(http.StatusNoContent).Write(rec)
		if rec.Code != http.StatusNoContent {
			t.Errorf("status = %d, want 204", rec.Code)
		}
		if rec.Body.Len() != 0 {
			t.Errorf("body must be empty, got %q", rec.Body.String())
		}
	})
	t.Run("headers are written before the status", func(t *testing.T) {
		rec := httptest.NewRecorder()
		resp := TooManyRequests("en", 30*time.Second)
		resp.Write(rec)
		if rec.Code != http.StatusTooManyRequests {
			t.Errorf("status = %d, want 429", rec.Code)
		}
		if got := rec.Header().Get("Retry-After"); got != "30" {
			t.Errorf("Retry-After = %q, want 30", got)
		}
	})
	t.Run("body sets content type and length", func(t *testing.T) {
		rec := httptest.NewRecorder()
		JSON(http.StatusTeapot, map[string]string{"a": "b"}).Write(rec)
		if rec.Code != http.StatusTeapot {
			t.Errorf("status = %d, want 418", rec.Code)
		}
		if got := rec.Header().Get("Content-Type"); got != "application/json" {
			t.Errorf("Content-Type = %q", got)
		}
		if got := rec.Header().Get("Content-Length"); got == "" {
			t.Errorf("Content-Length must be set")
		}
		if !strings.Contains(rec.Body.String(), `"a"`) {
			t.Errorf("body must carry the JSON payload, got %q", rec.Body.String())
		}
	})
	t.Run("marshal failure answers 500", func(t *testing.T) {
		rec := httptest.NewRecorder()
		// A channel cannot be marshaled — drives the encode-failure branch.
		JSON(http.StatusOK, make(chan int)).Write(rec)
		if rec.Code != http.StatusInternalServerError {
			t.Errorf("marshal failure must answer 500, got %d", rec.Code)
		}
	})
}

func TestFlushIsBestEffort(t *testing.T) {
	rec := httptest.NewRecorder()
	Flush(rec)             // httptest.Recorder implements http.Flusher — must not panic
	Flush(failingWriter{}) // non-flusher — must not panic
}

// failingWriter — a ResponseWriter without a Flush method.
type failingWriter struct{}

func (failingWriter) Header() http.Header       { return http.Header{} }
func (failingWriter) Write([]byte) (int, error) { return 0, nil }
func (failingWriter) WriteHeader(int)           {}

func TestInvalidBodyRenderers(t *testing.T) {
	t.Run("nil errors still render an empty details shape", func(t *testing.T) {
		resp := InvalidBody("en", nil)
		if resp.Status != http.StatusBadRequest {
			t.Errorf("status = %d, want 400", resp.Status)
		}
	})
	t.Run("details carry form and field errors", func(t *testing.T) {
		errs := validation.NewErrors()
		errs.Add("name", "required")
		resp := InvalidBody("en", errs)
		if resp.Status != http.StatusBadRequest {
			t.Errorf("status = %d, want 400", resp.Status)
		}
	})
	t.Run("WriteInvalidBody writes to the socket", func(t *testing.T) {
		rec := httptest.NewRecorder()
		WriteInvalidBody(rec, "en", nil)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want 400", rec.Code)
		}
	})
}

func TestInvalidIssuesRenderers(t *testing.T) {
	t.Run("nil errors render empty issues", func(t *testing.T) {
		resp := InvalidIssues("en", nil)
		if resp.Status != http.StatusBadRequest {
			t.Errorf("status = %d, want 400", resp.Status)
		}
	})
	t.Run("field errors travel through", func(t *testing.T) {
		errs := validation.NewErrors()
		errs.Add("slug", "reserved")
		resp := InvalidIssues("en", errs)
		if resp.Status != http.StatusBadRequest {
			t.Errorf("status = %d, want 400", resp.Status)
		}
	})
	t.Run("WriteInvalidIssues writes to the socket", func(t *testing.T) {
		rec := httptest.NewRecorder()
		WriteInvalidIssues(rec, "en", nil)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want 400", rec.Code)
		}
	})
}

func TestReadBodyOr413(t *testing.T) {
	t.Run("small body passes through", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/x", strings.NewReader(`{"a":1}`))
		body, ok := ReadBodyOr413(httptest.NewRecorder(), req)
		if !ok {
			t.Fatal("expected ok for a small body")
		}
		if string(body) != `{"a":1}` {
			t.Errorf("body = %q", body)
		}
	})
	t.Run("body over 1MB answers 413", func(t *testing.T) {
		big := strings.Repeat("x", (1<<20)+1)
		req := httptest.NewRequest(http.MethodPost, "/api/x", strings.NewReader(big))
		rec := httptest.NewRecorder()
		if _, ok := ReadBodyOr413(rec, req); ok {
			t.Fatal("oversized body must be refused")
		}
		if rec.Code != http.StatusRequestEntityTooLarge {
			t.Errorf("status = %d, want 413", rec.Code)
		}
		if got := rec.Header().Get("Connection"); got != "close" {
			t.Errorf("Connection = %q, want close", got)
		}
	})
	t.Run("read failure answers 400", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/x", failingReader{})
		rec := httptest.NewRecorder()
		if _, ok := ReadBodyOr413(rec, req); ok {
			t.Fatal("a failing body read must be refused")
		}
		if rec.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want 400", rec.Code)
		}
	})
}

// RateLimited's allowed path: without REDIS_URL the limiter fails open
// (ADR-019), so the request must proceed.
func TestRateLimitedFailsOpen(t *testing.T) {
	t.Setenv("REDIS_URL", "")
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/x", nil)
	if !RateLimited(rec, req, "rl:test", RateLimitConfig{Limit: 1, Window: time.Minute}) {
		t.Fatal("without REDIS_URL the limiter must fail open")
	}
	if rec.Code != http.StatusOK {
		t.Errorf("recorder must be untouched when allowed, got %d", rec.Code)
	}
}
