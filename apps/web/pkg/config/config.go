// Package config validates the Go API's environment once, at mux
// construction. Before this, a missing
// AUTH_SECRET degraded silently into "every organizer is anonymous"
// with a single log line — a production misconfiguration looked like a
// login bug. Validate() makes it a hard startup error instead.
package config

import (
	"fmt"
	"net/url"
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
// panics still surface them at first use. Set STRICT_ENV=1 to opt a
// non-production environment into the same validation.
func Validate() error {
	if !IsProduction() && os.Getenv("STRICT_ENV") != "1" {
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
	// QSTASH_CURRENT_SIGNING_KEY — the receiver refuses every delivery
	// without it (500 → QStash burns its retry budget in a loop).
	// QSTASH_NEXT_SIGNING_KEY is deliberately NOT required: it is only
	// consulted during key rotation and may legitimately be empty.
	require("QSTASH_CURRENT_SIGNING_KEY")
	// TELEGRAM_BOT_TOKEN — without it every notification send fails at
	// job time (500 → QStash retries a job that can never succeed).
	require("TELEGRAM_BOT_TOKEN")

	if len(missing) > 0 {
		return fmt.Errorf("missing required environment variables: %s", strings.Join(missing, ", "))
	}

	// APP_URL shape: queue.destination concatenates it into the QStash
	// publish URL, so a malformed value must fail the cold start, not
	// publish notifications to nowhere. Scheme + host only: a trailing
	// path, query or fragment would silently misroute every publish
	// destination.
	if u, err := url.Parse(strings.TrimSpace(os.Getenv("APP_URL"))); err != nil ||
		(u.Scheme != "http" && u.Scheme != "https") || u.Host == "" ||
		(u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" ||
		u.User != nil {
		return fmt.Errorf("APP_URL must be an absolute http(s) URL without a path, query or fragment, got %q", os.Getenv("APP_URL"))
	}
	return nil
}

// IsProduction is the single source of truth for "is this a production
// deployment" — NODE_ENV or VERCEL_ENV equals "production". Every
// package that needs the answer imports it; two local copies once
// drifted into an incident class (publishing notifications to
// nowhere because one copy disagreed about what counts as prod).
func IsProduction() bool {
	return os.Getenv("NODE_ENV") == "production" || os.Getenv("VERCEL_ENV") == "production"
}

// RedisConfigured reports whether a Redis URL is present. One shared
// answer instead of three os.Getenv checks that could drift.
func RedisConfigured() bool {
	return strings.TrimSpace(os.Getenv("REDIS_URL")) != ""
}
