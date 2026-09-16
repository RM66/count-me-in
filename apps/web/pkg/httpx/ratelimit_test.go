package httpx

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"
)

// TestAllowFailsOpenWithoutRedis — with no REDIS_URL the limiter must
// let every request through (a limiter outage must never block traffic).
func TestAllowFailsOpenWithoutRedis(t *testing.T) {
	t.Setenv("REDIS_URL", "")
	allowed, _ := Allow(context.Background(), "rl:test", RateLimitConfig{Limit: 1, Window: time.Minute})
	if !allowed {
		t.Fatal("expected fail-open when REDIS_URL is unset")
	}
}

// TestClientIP — the first value of the forwarded-for chain is the
// original client; RemoteAddr is the dev fallback.
func TestClientIP(t *testing.T) {
	r := httptest.NewRequest("POST", "/", nil)
	r.Header.Set("x-forwarded-for", "203.0.113.7, 10.0.0.1")
	if got := ClientIP(r); got != "203.0.113.7" {
		t.Fatalf("ClientIP = %q, want 203.0.113.7", got)
	}

	r2 := httptest.NewRequest("POST", "/", nil)
	if got := ClientIP(r2); got == "" {
		t.Fatal("expected RemoteAddr fallback to be non-empty")
	}
}
