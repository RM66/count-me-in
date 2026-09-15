package httpx

import (
	"net/http/httptest"
	"testing"
)

func TestPathParam(t *testing.T) {
	cases := []struct {
		path, prefix, want string
	}{
		{"/api/services/abc123", "/api/services/", "abc123"},
		{"/api/services/demo-yoga", "/api/services/", "demo-yoga"},
		{"/api/jobs/booking.created", "/api/jobs/", "booking.created"},
		{"/api/jobs/demo.refresh", "/api/jobs/", "demo.refresh"},
		{"/api/services/a%20b", "/api/services/", "a b"},
		{"/api/services/", "/api/services/", ""},
	}
	for _, c := range cases {
		r := httptest.NewRequest("POST", c.path, nil)
		if got := PathParam(r, c.prefix); got != c.want {
			t.Errorf("PathParam(%q) = %q, want %q", c.path, got, c.want)
		}
	}
}
