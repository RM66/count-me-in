// Package api assembles the Go API from the oapi-codegen artifacts
// (ADR-016): the generated std-http router dispatches every operation,
// and thin adapters forward to the handlers in pkg/routes with the
// extracted path params.
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"time"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/config"
	"countmein/pkg/db"
	"countmein/pkg/redis"
)

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
	// lives here instead of the spec: a
	// liveness probe with dependency checks — PG and Redis. QStash is
	// deliberately not probed: an outbound call per probe would burn
	// the request budget; publish failures surface through the outbox
	// backlog metrics instead.
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/healthz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		checks := map[string]string{"postgres": "ok", "redis": "ok"}
		status := http.StatusOK
		if err := db.Pool().Ping(ctx); err != nil {
			checks["postgres"] = "fail"
			status = http.StatusServiceUnavailable
		}
		if os.Getenv("REDIS_URL") != "" {
			if err := redis.Client().Ping(ctx).Err(); err != nil {
				checks["redis"] = "fail"
				status = http.StatusServiceUnavailable
			}
		} else {
			checks["redis"] = "skipped"
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(checks)
	})
	mux.Handle("/", api)
	return mux, nil
}
