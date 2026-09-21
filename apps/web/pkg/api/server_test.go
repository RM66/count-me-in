package api

import (
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
	handler := NewMux()
	for _, op := range muxOperations {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(op.method, op.path, nil))
		if rec.Code == http.StatusNotFound || rec.Code == http.StatusMethodNotAllowed {
			t.Errorf("%s %s: not routed by the generated mux (status %d)", op.method, op.path, rec.Code)
		}
	}
}
