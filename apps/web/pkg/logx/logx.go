// Package logx is the Go API's observability floor: one JSON object
// per line on stdout, built on log/slog's JSON handler. Vercel captures
// function stdout into log drains, and JSON keeps the fields queryable
// there. Sentry/PostHog from the TS handlers are out of the dependency
// set — this is what stands in for them (structured logging is the
// baseline requirement).
//
// Deliberately dependency-free and importable from anywhere (unlike a
// logger living in httpx, which auth/db cannot import without cycles).
// slog's handler serializes each record under a mutex, so concurrent
// writers (the inline outbox publish) cannot interleave lines.
package logx

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"
)

// logger is the process-wide JSON-lines logger. Built once; slog's
// handler is safe for concurrent use.
var logger = slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
	// Info level and above — debug stays out of production logs.
	Level: slog.LevelInfo,
}))

// emit writes one record. fields are attached as record attributes.
func emit(level slog.Level, msg string, fields map[string]any) {
	attrs := make([]any, 0, len(fields))
	for k, v := range fields {
		attrs = append(attrs, slog.Any(k, v))
	}
	logger.Log(context.Background(), level, msg, attrs...)
}

// Info logs a notable event: skips, refusals, lifecycle.
func Info(msg string, fields map[string]any) { emit(slog.LevelInfo, msg, fields) }

// Warn logs a condition that degrades behavior but does not fail the
// request (fail-open limiter, missing optional env).
func Warn(msg string, fields map[string]any) { emit(slog.LevelWarn, msg, fields) }

// Error logs a failure; nil errors are dropped so callers can pass
// optional errors straight through.
func Error(err error, fields map[string]any) {
	if err == nil {
		return
	}
	emit(slog.LevelError, err.Error(), fields)
}

// warnEveryState tracks the last emission time per message, so a
// persistent fault stays visible in the logs without spamming one line
// per request. sync.Once was rejected here: on a warmed serverless
// instance it prints exactly once for the process lifetime, which makes
// a production misconfiguration nearly invisible.
var (
	warnEveryMu   sync.Mutex
	warnEveryLast = map[string]time.Time{}
)

// WarnEvery logs msg at most once per interval. Use for conditions that
// repeat on every request (missing secret, broken token) — the first
// occurrence and a periodic heartbeat, not a flood.
func WarnEvery(interval time.Duration, msg string, fields map[string]any) {
	warnEveryMu.Lock()
	last, seen := warnEveryLast[msg]
	if seen && time.Since(last) < interval {
		warnEveryMu.Unlock()
		return
	}
	warnEveryLast[msg] = time.Now()
	warnEveryMu.Unlock()
	Warn(msg, fields)
}

// NewTraceID generates a short random hex id for correlating a request
// across the async pipeline. The id travels
// in the QStash job payload and is emitted in every log line in both the
// API handler and the job handler, so debugging "I booked but didn't get
// a message" becomes a grep for one id instead of archaeology across
// separate invocations.
func NewTraceID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand should never fail on a healthy system; fall back
		// to a timestamp so the field is never empty.
		return fmt.Sprintf("t%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}
