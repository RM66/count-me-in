// Package api assembles the Go API from the oapi-codegen artifacts
// (ADR-016): the generated std-http router dispatches every operation,
// and thin adapters forward to the handlers in pkg/routes with the
// extracted path params.
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"runtime/debug"
	"strings"
	"time"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/config"
	"countmein/pkg/db"
	"countmein/pkg/httpx"
	"countmein/pkg/logx"
	"countmein/pkg/redis"
)

// Health probes are variables so tests can pin the recover path without
// initializing the process-wide pools (db.Pool panics on a missing
// POSTGRES_URL and caches that failure for the process lifetime — a
// test triggering it would poison every later test in this package).
var (
	probePostgres = func(ctx context.Context) error { return db.Pool().Ping(ctx) }
	probeRedis    = func(ctx context.Context) error { return redis.Client().Ping(ctx).Err() }
)

// missingHealthzEnv names the connection variables that are absent or
// blank. The recover below cannot know which probe panicked (both
// panic from inside the lazy singletons), so the list reports env
// presence — a fact — instead of guessing which dependency failed.
func missingHealthzEnv() []string {
	missing := []string{}
	for _, name := range []string{"POSTGRES_URL", "REDIS_URL"} {
		if strings.TrimSpace(os.Getenv(name)) == "" {
			missing = append(missing, name)
		}
	}
	return missing
}

// handleHealthz is the liveness probe with dependency checks — PG and
// Redis. QStash is deliberately not probed: an outbound call per probe
// would burn the request budget; publish failures surface through the
// outbox backlog metrics instead.
//
// The handler carries its own recover: db.Pool() and redis.Client()
// panic on a missing connection env, and the probe is exactly the
// place where that misconfiguration must surface as a 503 with a JSON
// body naming the broken dependency — not as a connection reset with a
// runtime stack in the log. It is also rate-limited: the probe is
// unauthenticated and each call burns a connection from the small
// serverless pool; the limiter fails open, so monitoring survives a
// Redis outage.
func handleHealthz(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if rec := recover(); rec != nil {
			stack := debug.Stack()
			const maxStack = 8 << 10
			if len(stack) > maxStack {
				stack = stack[:maxStack]
			}
			logx.Error(fmt.Errorf("healthz panic: %v", rec), map[string]any{
				"scope": "healthz",
				"stack": string(stack),
			})
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"postgres":   "fail",
				"redis":      "fail",
				"error":      fmt.Sprintf("dependency probe panicked: %v", rec),
				"missingEnv": missingHealthzEnv(),
			})
		}
	}()
	if !httpx.RateLimited(w, r, "rl:healthz:"+httpx.ClientIP(r), httpx.RateLimitConfig{Limit: 30, Window: time.Minute}) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	checks := map[string]string{"postgres": "ok", "redis": "ok"}
	status := http.StatusOK
	if err := probePostgres(ctx); err != nil {
		checks["postgres"] = "fail"
		status = http.StatusServiceUnavailable
	}
	if config.RedisConfigured() {
		if err := probeRedis(ctx); err != nil {
			checks["redis"] = "fail"
			status = http.StatusServiceUnavailable
		}
	} else {
		checks["redis"] = "skipped"
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(checks)
}

// NewMux builds the generated router: every operation from the spec,
// dispatched through the StrictServerInterface's non-strict twin to the
// existing handlers. The patterns are method-scoped ("POST /api/services",
// "GET /api/services/{id}", …), so method routing comes from the spec too.
//
// Env validation runs here: a missing
// AUTH_SECRET in production must fail the cold start loudly, not
// degrade into "every organizer is anonymous".
func NewMux() (http.Handler, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	api := gen.Handler(newAdapters())
	// /api/healthz is infrastructure, not a contract endpoint, so it
	// lives here instead of the spec.
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/healthz", handleHealthz)
	mux.Handle("/", api)
	return mux, nil
}
