package httpx

import (
	"fmt"
	"net/http"

	"api-go/internal/logx"
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

// PathParam extracts the single dynamic segment after prefix, e.g.
// PathParam(r, "/api/services/") → the {id} of /api/services/{id}.
// Vercel Go functions receive the original URL; route params are not
// injected into the request, so handlers parse them off the path.
// r.URL.Path is already percent-decoded by net/http — no second
// unescape here, or %2520-style input would decode twice.
func PathParam(r *http.Request, prefix string) string {
	rest := r.URL.Path
	if len(rest) > len(prefix) {
		rest = rest[len(prefix):]
	} else {
		rest = ""
	}
	// One segment only — anything deeper did not match this route.
	for i := 0; i < len(rest); i++ {
		if rest[i] == '/' {
			rest = rest[:i]
			break
		}
	}
	return rest
}
