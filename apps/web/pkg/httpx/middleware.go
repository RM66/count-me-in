package httpx

import (
	"fmt"
	"net/http"

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
		defer func() {
			if rec := recover(); rec != nil {
				logx.Error(fmt.Errorf("panic: %v", rec), map[string]any{
					"method": r.Method,
					"path":   r.URL.Path,
				})
				w.WriteHeader(http.StatusInternalServerError)
			}
		}()
		next(w, r)
	}
}
