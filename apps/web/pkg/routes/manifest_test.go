package routes

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"countmein/pkg/contracts"
)

// The mux and the manifest must describe the same surface. The test needs no
// database: an undeclared method is refused by the handler's method switch
// before any query runs, and a declared one fails later (panic → 500 via
// Recover), which is still distinguishable from 405/404.

var allMethods = []string{
	http.MethodGet, http.MethodPost, http.MethodPut,
	http.MethodPatch, http.MethodDelete,
}

// samplePath substitutes a concrete value for each {param} segment.
func samplePath(pattern string) string {
	r := strings.NewReplacer(
		"{id}", "01930000-0000-7000-8000-000000000001",
		"{queue}", contracts.QueueDemoRefresh,
	)
	out := r.Replace(pattern)
	if strings.Contains(out, "{") {
		panic("manifest_test: unhandled path parameter in " + pattern)
	}
	return out
}

func statusFor(t *testing.T, method, path string) int {
	t.Helper()
	rec := httptest.NewRecorder()
	NewMux().ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader("{}")))
	return rec.Code
}

func TestManifestCoversMux(t *testing.T) {
	t.Setenv("POSTGRES_URL", "")

	declared := map[string]bool{}
	for _, route := range contracts.APIRoutes {
		declared[route.Method+" "+route.Path] = true
	}

	// Every declared operation is dispatchable.
	for _, route := range contracts.APIRoutes {
		code := statusFor(t, route.Method, samplePath(route.Path))
		if code == http.StatusMethodNotAllowed || code == http.StatusNotFound {
			t.Errorf("%s %s is in contracts.APIRoutes but the mux answers %d", route.Method, route.Path, code)
		}
	}

	// No undeclared method is dispatchable on a declared path.
	seen := map[string]bool{}
	for _, route := range contracts.APIRoutes {
		if seen[route.Path] {
			continue
		}
		seen[route.Path] = true
		for _, method := range allMethods {
			if declared[method+" "+route.Path] {
				continue
			}
			if code := statusFor(t, method, samplePath(route.Path)); code != http.StatusMethodNotAllowed {
				t.Errorf("%s %s is not in contracts.APIRoutes but the mux answers %d, not 405", method, route.Path, code)
			}
		}
	}
}
