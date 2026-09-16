package httpx

import (
	"fmt"
	"net/http"
	"strings"

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

// RequireMethod answers 405 (with an Allow header, like Next.js route
// files) for anything else and calls next only for the wanted one.
func RequireMethod(w http.ResponseWriter, r *http.Request, method string, next func()) {
	if r.Method != method {
		w.Header().Set("Allow", method)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	next()
}

// PathParam extracts the single dynamic segment of a route.
//
// Production (Vercel): vercel.json rewrites map /api/services/:id →
// /api/services/by-id, and Vercel injects the matched :id as a query
// parameter (?id=abc123). The Go function's r.URL.Path is the
// destination (/api/services/by-id), so the real value is in the query
// string — queryKey names it ("id" for services/slots, "queue" for jobs).
//
// Dev (cmd/dev): Go 1.22+ http.ServeMux patterns route /api/services/{id}
// directly, so the segment lives in the path after prefix.
//
// r.URL.Path is already percent-decoded by net/http — no second unescape
// here, or %2520-style input would decode twice.
func PathParam(r *http.Request, prefix, queryKey string) string {
	// Production: Vercel rewrites pass the dynamic segment as a query param.
	if v := r.URL.Query().Get(queryKey); v != "" {
		return v
	}
	// Dev: the segment is in the path after prefix.
	// Strict prefix check: without it a path that merely shares a length
	// with the prefix would strip the wrong number of bytes and return
	// garbage as the param.
	if !strings.HasPrefix(r.URL.Path, prefix) {
		return ""
	}
	rest := r.URL.Path[len(prefix):]
	// One segment only — anything deeper did not match this route.
	for i := 0; i < len(rest); i++ {
		if rest[i] == '/' {
			rest = rest[:i]
			break
		}
	}
	return rest
}
