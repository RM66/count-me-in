package httpx

import (
	"fmt"
	"net/http"
	"runtime/debug"

	"countmein/pkg/logx"
)

// Recover wraps a handler: a panic is logged and answered with a 500
// instead of crashing the function. Mirrors what the Next.js runtime
// did for unhandled route errors.
//
// It also sets the default response headers every API response needs.
// The Go origin is reached via beforeFiles rewrites in next.config.js,
// so the Next.js headers() config does not apply to its responses —
// the Go side must set its own:
//   - Vary: Accept-Language — API error copy is localized per request
//     (ApiErrors dictionaries), so shared caches must key by language.
//   - X-Robots-Tag: noindex — mirrors the next.config.js rule for
//     /api/:path*; belt-and-braces alongside the meta robots on pages.
//
// Path and query parameters are not extracted here: the generated router
// (pkg/api) owns both — it matches the method+path pattern and forwards
// {id}/{queue} and bound query params to the adapters explicitly.
func Recover(next func(w http.ResponseWriter, r *http.Request)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Vary", "Accept-Language")
		w.Header().Set("X-Robots-Tag", "noindex")
		// API responses are per-request (auth, rate limits, live seat
		// counts) — no shared or browser cache may store them.
		w.Header().Set("Cache-Control", "no-store")
		// Security headers: the Go origin
		// bypasses next.config.js headers(), so the API must set its own.
		// No CSP here — API responses are JSON, never HTML documents.
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		defer func() {
			if rec := recover(); rec != nil {
				// The stack is the only trace of where the panic came
				// from — the recover value alone cannot be mapped back
				// to a line. Truncated so a deep recursive panic cannot
				// flood the log line.
				stack := debug.Stack()
				const maxStack = 8 << 10
				if len(stack) > maxStack {
					stack = stack[:maxStack]
				}
				logx.Error(fmt.Errorf("panic: %v", rec), map[string]any{
					"method": r.Method,
					"path":   r.URL.Path,
					"stack":  string(stack),
				})
				w.WriteHeader(http.StatusInternalServerError)
			}
		}()
		next(w, r)
	}
}
