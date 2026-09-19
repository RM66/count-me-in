package httpx

import (
	"net/http/httptest"
	"testing"
)

func TestPathParam(t *testing.T) {
	// Dev mode: the dynamic segment lives in the path after the prefix.
	pathCases := []struct {
		path, prefix, queryKey, want string
	}{
		{"/api/services/abc123", "/api/services/", "id", "abc123"},
		{"/api/services/demo-yoga", "/api/services/", "id", "demo-yoga"},
		{"/api/jobs/booking.created", "/api/jobs/", "queue", "booking.created"},
		{"/api/jobs/demo.refresh", "/api/jobs/", "queue", "demo.refresh"},
		{"/api/services/a%20b", "/api/services/", "id", "a b"},
		{"/api/services/", "/api/services/", "id", ""},
	}
	for _, c := range pathCases {
		r := httptest.NewRequest("POST", c.path, nil)
		if got := PathParam(r, c.prefix, c.queryKey); got != c.want {
			t.Errorf("PathParam(%q, %q) = %q, want %q", c.path, c.queryKey, got, c.want)
		}
	}

	// Production (Vercel): every route is rewritten to the single function
	// at /api/entry, which restores r.URL.Path from ?_path. Vercel injects
	// the matched segment as a query parameter (?id / ?queue); PathParam
	// reads it before falling back to the (restored) path. These cases
	// model the request as the entry sees it: _path restored to the real
	// route and the segment also present as a query param.
	queryCases := []struct {
		path, query, prefix, queryKey, want string
	}{
		{"/api/services/abc123", "_path=/api/services/abc123&id=abc123", "/api/services/", "id", "abc123"},
		{"/api/services/demo-yoga", "_path=/api/services/demo-yoga&id=demo-yoga", "/api/services/", "id", "demo-yoga"},
		{"/api/slots/slot-42", "_path=/api/slots/slot-42&id=slot-42", "/api/slots/", "id", "slot-42"},
		{"/api/jobs/booking.created", "_path=/api/jobs/booking.created&queue=booking.created", "/api/jobs/", "queue", "booking.created"},
		{"/api/jobs/demo.refresh", "_path=/api/jobs/demo.refresh&queue=demo.refresh", "/api/jobs/", "queue", "demo.refresh"},
	}
	for _, c := range queryCases {
		r := httptest.NewRequest("POST", c.path+"?"+c.query, nil)
		if got := PathParam(r, c.prefix, c.queryKey); got != c.want {
			t.Errorf("PathParam(%q?%q, %q) = %q, want %q", c.path, c.query, c.queryKey, got, c.want)
		}
	}
}
