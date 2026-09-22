// Package logx is the Go API's observability floor: one JSON object
// per line on stdout. Vercel captures function stdout into log drains,
// and JSON keeps the fields queryable there. Sentry/PostHog from the
// TS handlers are out of the dependency set — this is what stands in
// for them (structured logging is the baseline requirement).
//
// Deliberately dependency-free and importable from anywhere (unlike a
// logger living in httpx, which auth/db cannot import without cycles).
package logx

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

func write(level, msg string, fields map[string]any) {
	entry := make(map[string]any, len(fields)+3)
	for k, v := range fields {
		entry[k] = v
	}
	entry["level"] = level
	entry["msg"] = msg
	entry["time"] = time.Now().UTC().Format(time.RFC3339Nano)
	raw, err := json.Marshal(entry)
	if err != nil {
		// Logging must never fail a request — fall back to a bare line.
		fmt.Printf("{\"level\":%q,\"msg\":%q}\n", level, msg)
		return
	}
	fmt.Println(string(raw))
}

// Info logs a notable event: skips, refusals, lifecycle.
func Info(msg string, fields map[string]any) { write("info", msg, fields) }

// Error logs a failure; nil errors are dropped so callers can pass
// optional errors straight through.
func Error(err error, fields map[string]any) {
	if err == nil {
		return
	}
	write("error", err.Error(), fields)
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
