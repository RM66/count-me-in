// Package config validates the Go API's environment once, at mux
// construction. Before this, a missing
// AUTH_SECRET degraded silently into "every organizer is anonymous"
// with a single log line — a production misconfiguration looked like a
// login bug. Validate() makes it a hard startup error instead.
package config

import (
	"fmt"
	"os"
	"strings"
)

// Validate checks the environment the Go API needs. Called from
// api.NewMux so every cold start fails fast with a clear message
// instead of degrading at first use.
//
// Production-only: in development (no VERCEL_ENV/NODE_ENV=production)
// the API runs against local docker-compose services where secrets are
// routinely absent, so validation is skipped — the lazy per-package
// panics still surface them at first use.
func Validate() error {
	if !isProduction() {
		return nil
	}
	missing := []string{}
	require := func(name string) {
		if strings.TrimSpace(os.Getenv(name)) == "" {
			missing = append(missing, name)
		}
	}

	// AUTH_SECRET — mints/verifies the organizer-auth JWT; without it
	// every organizer write silently becomes anonymous.
	require("AUTH_SECRET")
	// POSTGRES_URL / REDIS_URL — the data plane; the pools panic lazily,
	// validation turns that into a startup error.
	require("POSTGRES_URL")
	require("REDIS_URL")
	// APP_URL — QStash publish destinations are built from it; empty
	// means notifications publish to nowhere.
	require("APP_URL")
	// QSTASH_TOKEN — publishing in production without it is an error
	// (queue.PublishOutbox refuses).
	require("QSTASH_TOKEN")

	if len(missing) > 0 {
		return fmt.Errorf("missing required environment variables: %s", strings.Join(missing, ", "))
	}
	return nil
}

func isProduction() bool {
	return os.Getenv("NODE_ENV") == "production" || os.Getenv("VERCEL_ENV") == "production"
}
