// Tests for the single Vercel entry point's path restore: ?_path is an
// internal rewrite artifact, never a client input, and the helper that
// strips it must preserve every other query parameter verbatim.
package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStripQueryParam(t *testing.T) {
	for _, tc := range []struct {
		name     string
		rawQuery string
		want     string
	}{
		{"removes a leading key", "_path=/api/services&limit=10", "limit=10"},
		{"removes a trailing key", "limit=10&_path=/api/services", "limit=10"},
		{"removes a valueless key", "_path&x=1", "x=1"},
		{"removes the only key", "_path=/api/healthz", ""},
		{"keeps lookalike names", "_pathology=1&x=2", "_pathology=1&x=2"},
		{"empty query", "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := stripQueryParam(tc.rawQuery, "_path"); got != tc.want {
				t.Errorf("stripQueryParam(%q) = %q, want %q", tc.rawQuery, got, tc.want)
			}
		})
	}
}

// Anything that is not an /api/... path is answered 404 instead of being
// dispatched: the rewrite only ever produces /api/ paths, so a foreign
// value is a client trying to steer the router.
func TestHandlerRejectsForeignPath(t *testing.T) {
	for _, orig := range []string{"/etc/passwd", "https://evil.example.com", "//evil.example.com", "/api", "api/services"} {
		r := httptest.NewRequest(http.MethodGet, "/api/entry", nil)
		q := r.URL.Query()
		q.Set("_path", orig)
		r.URL.RawQuery = q.Encode()
		w := httptest.NewRecorder()

		Handler(w, r)

		if w.Code != http.StatusNotFound {
			t.Errorf("_path=%q must be answered 404, got %d", orig, w.Code)
		}
	}
}

// A valid _path is restored onto the request and stripped from the query
// so handlers never see or log the rewrite artifact. /api/healthz is the
// one route that needs no ticket/session, so it can be dispatched here.
func TestHandlerRestoresAPIPath(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/api/entry", nil)
	q := r.URL.Query()
	q.Set("_path", "/api/healthz")
	r.URL.RawQuery = q.Encode()
	w := httptest.NewRecorder()

	Handler(w, r)

	if w.Code == http.StatusNotFound {
		t.Fatal("a valid /api/ path must be dispatched, not answered 404")
	}
	if r.URL.Path != "/api/healthz" {
		t.Errorf("path = %q, want /api/healthz", r.URL.Path)
	}
	if strings.Contains(r.URL.RawQuery, "_path") {
		t.Errorf("_path must be stripped from RawQuery, got %q", r.URL.RawQuery)
	}
}
