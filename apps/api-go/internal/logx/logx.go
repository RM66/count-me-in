// Package logx is the Go API's observability floor: one JSON object
// per line on stdout. Vercel captures function stdout into log drains,
// and JSON keeps the fields queryable there. Sentry/PostHog from the
// TS handlers are out of the dependency set — this is what stands in
// for them (implementation-review must-have: structured logging).
//
// Deliberately dependency-free and importable from anywhere (unlike a
// logger living in httpx, which auth/db cannot import without cycles).
package logx

import (
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
