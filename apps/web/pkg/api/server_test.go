package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	gen "countmein/pkg/api/gen"
)

// muxOperations pins the dispatched surface: every operation in the spec
// must be routed by the generated mux. A request that reaches the adapter
// (as opposed to a 404/405 from the mux itself) proves the pattern is
// registered; the handlers then reject without a session/DB, which is
// fine — dispatch is what this pins. TestSpecLoads derives its expected
// path set from this table, so a new path (or a new method on an
// existing path) moves both together.
var muxOperations = []struct {
	method string
	path   string
}{
	{"POST", "/api/auth/telegram-guest"},
	{"POST", "/api/auth/telegram-signup"},
	{"POST", "/api/bookings"},
	{"POST", "/api/bookings/cancel"},
	{"POST", "/api/bookings/cancel-by-organizer"},
	{"POST", "/api/bookings/lookup"},
	{"POST", "/api/jobs/booking.created"},
	{"POST", "/api/jobs/booking.cancelled"},
	{"POST", "/api/jobs/demo.refresh"},
	{"POST", "/api/jobs/notification.outbox.sweep"},
	{"POST", "/api/organizers"},
	{"GET", "/api/organizers/me"},
	{"PUT", "/api/organizers/me"},
	{"POST", "/api/organizers/me/avatar"},
	{"PATCH", "/api/organizers/me/language"},
	{"POST", "/api/organizers/me/service-photo"},
	{"GET", "/api/services"},
	{"POST", "/api/services"},
	{"GET", "/api/services/00000000-0000-0000-0000-000000000000"},
	{"PUT", "/api/services/00000000-0000-0000-0000-000000000000"},
	{"DELETE", "/api/services/00000000-0000-0000-0000-000000000000"},
	{"GET", "/api/slots"},
	{"POST", "/api/slots"},
	{"GET", "/api/slots/00000000-0000-0000-0000-000000000000"},
	{"PUT", "/api/slots/00000000-0000-0000-0000-000000000000"},
	{"DELETE", "/api/slots/00000000-0000-0000-0000-000000000000"},
}

// specPathOf maps a concrete dispatch path back to its spec spelling:
// the zero-uuid probe stands for {id}, a queue name for {queue}.
func specPathOf(path string) string {
	seg := path[strings.LastIndex(path, "/")+1:]
	switch {
	case seg == "00000000-0000-0000-0000-000000000000":
		return path[:strings.LastIndex(path, "/")] + "/{id}"
	case strings.HasPrefix(seg, "booking.") || seg == "demo.refresh" || seg == "notification.outbox.sweep":
		return path[:strings.LastIndex(path, "/")] + "/{queue}"
	default:
		return path
	}
}

// TestSpecLoads: the embedded spec must parse via kin-openapi — this is
// what request validation runs against — and its path set must equal the
// dispatched surface exactly.
func TestSpecLoads(t *testing.T) {
	spec, err := gen.GetSwagger()
	if err != nil {
		t.Fatalf("embedded spec failed to load: %v", err)
	}
	want := make(map[string]bool)
	for _, op := range muxOperations {
		want[specPathOf(op.path)] = true
	}
	got := spec.Paths.Map()
	if len(got) != len(want) {
		t.Errorf("spec paths: got %v, want %v", sortedKeys(got), sortedKeys(want))
	}
	for path := range want {
		if _, ok := got[path]; !ok {
			t.Errorf("spec is missing path %s", path)
		}
	}
}

func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// TestMuxDispatchesEveryOperation: every operation in the spec must be
// routed by the generated mux (see muxOperations).
func TestMuxDispatchesEveryOperation(t *testing.T) {
	handler, err := NewMux()
	if err != nil {
		t.Fatalf("NewMux: %v", err)
	}
	for _, op := range muxOperations {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(op.method, op.path, nil))
		if rec.Code == http.StatusMethodNotAllowed {
			t.Errorf("%s %s: not routed by the generated mux (status %d)", op.method, op.path, rec.Code)
			continue
		}
		if rec.Code == http.StatusNotFound && !isJSONError(rec) {
			// The generated mux answers 404 (405 for a wrong method) with
			// a text/plain body; route handlers answer their own 404s
			// (unknown service/slot id, foreign queue) as JSON error
			// bodies. Without a database the zero-uuid probes below panic
			// into a 500; against a real database they legitimately
			// answer a handler-level 404 — both prove the pattern is
			// registered, only a mux-level 404 does not.
			t.Errorf("%s %s: not routed by the generated mux (status %d)", op.method, op.path, rec.Code)
		}
	}
}

// isJSONError reports whether the recorder carries a route-handler JSON
// error body rather than the mux's own text/plain 404 page.
func isJSONError(rec *httptest.ResponseRecorder) bool {
	return strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json")
}

// ── healthz ───────────────────────────────────────────────────────────────────
//
// The healthz probe must answer a JSON 503 naming the broken dependency
// when a probe panics (missing connection env in production) — not a
// bare 500 or a process crash. The probes are injected (server.go) so
// the test never touches the process-wide pools: db.Pool() caches a
// missing-env failure for the lifetime of the process, which would
// poison every later test in this package.

func healthzRequest(t *testing.T) *httptest.ResponseRecorder {
	t.Helper()
	// No Redis: the redis branch reports "skipped" instead of probing.
	t.Setenv("REDIS_URL", "")
	t.Setenv("VERCEL", "")
	t.Setenv("TRUST_PROXY_HEADERS", "")
	r := httptest.NewRequest(http.MethodGet, "/api/healthz", nil)
	w := httptest.NewRecorder()
	handleHealthz(w, r)
	return w
}

func decodeHealthzBody(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("healthz body must be JSON, got %q: %v", w.Body.String(), err)
	}
	return body
}

func TestHealthzProbePanicAnswers503WithMissingEnv(t *testing.T) {
	prev := probePostgres
	probePostgres = func(context.Context) error { panic("POSTGRES_URL is not set") }
	t.Cleanup(func() { probePostgres = prev })
	t.Setenv("POSTGRES_URL", "")

	w := healthzRequest(t)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("panicking probe must answer 503, got %d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	body := decodeHealthzBody(t, w)
	if body["postgres"] != "fail" || body["redis"] != "fail" {
		t.Errorf("body must mark both dependencies failed, got %v", body)
	}
	missing, _ := body["missingEnv"].([]any)
	found := false
	for _, name := range missing {
		if name == "POSTGRES_URL" {
			found = true
		}
	}
	if !found {
		t.Errorf("missingEnv = %v, want it to name POSTGRES_URL", body["missingEnv"])
	}
	if msg, _ := body["error"].(string); !strings.Contains(msg, "POSTGRES_URL is not set") {
		t.Errorf("error must carry the panic text, got %q", msg)
	}
}

func TestHealthzProbeFailureAnswers503(t *testing.T) {
	prev := probePostgres
	probePostgres = func(context.Context) error { return errors.New("connection refused") }
	t.Cleanup(func() { probePostgres = prev })

	w := healthzRequest(t)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("failed probe must answer 503, got %d", w.Code)
	}
	body := decodeHealthzBody(t, w)
	if body["postgres"] != "fail" {
		t.Errorf("postgres = %v, want fail", body["postgres"])
	}
	if body["redis"] != "skipped" {
		t.Errorf("redis = %v, want skipped without REDIS_URL", body["redis"])
	}
}

func TestHealthzHealthyAnswers200(t *testing.T) {
	prev := probePostgres
	probePostgres = func(context.Context) error { return nil }
	t.Cleanup(func() { probePostgres = prev })

	w := healthzRequest(t)
	if w.Code != http.StatusOK {
		t.Fatalf("healthy probe must answer 200, got %d (%s)", w.Code, w.Body.String())
	}
	body := decodeHealthzBody(t, w)
	if body["postgres"] != "ok" || body["redis"] != "skipped" {
		t.Errorf("body = %v, want postgres ok / redis skipped", body)
	}
}
