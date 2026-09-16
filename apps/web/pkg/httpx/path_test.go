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

	// Production (Vercel): vercel.json rewrites pass the dynamic segment
	// as a query parameter; r.URL.Path is the destination (by-id / by-queue).
	queryCases := []struct {
		path, query, prefix, queryKey, want string
	}{
		{"/api/services/by-id", "id=abc123", "/api/services/", "id", "abc123"},
		{"/api/services/by-id", "id=demo-yoga", "/api/services/", "id", "demo-yoga"},
		{"/api/slots/by-id", "id=slot-42", "/api/slots/", "id", "slot-42"},
		{"/api/jobs/by-queue", "queue=booking.created", "/api/jobs/", "queue", "booking.created"},
		{"/api/jobs/by-queue", "queue=demo.refresh", "/api/jobs/", "queue", "demo.refresh"},
	}
	for _, c := range queryCases {
		r := httptest.NewRequest("POST", c.path+"?"+c.query, nil)
		if got := PathParam(r, c.prefix, c.queryKey); got != c.want {
			t.Errorf("PathParam(%q?%q, %q) = %q, want %q", c.path, c.query, c.queryKey, got, c.want)
		}
	}
}
