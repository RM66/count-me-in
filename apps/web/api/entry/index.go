// api/entry is the single Vercel Serverless Function for the Go API
// (the "fat lambda"). Every /api/* route (except Auth.js, which stays on
// Next.js) is rewritten here by vercel.json and dispatched by the
// oapi-codegen router from pkg/api — the spec is the manifest, so the
// dispatched surface and the OpenAPI document cannot diverge (ADR-016).
// Consolidating 16 per-route functions into one keeps the deployment
// under Vercel Hobby's 12-function limit and lets a single warmed
// instance + connection pool serve the whole API.
//
// The mux is built once at package init and reused across invocations.
package handler

import (
	"net/http"
	"strings"

	"countmein/pkg/api"
)

// Env validation fails the cold start loudly on a production
// misconfiguration; a panic here surfaces as a 500 on every request,
// which is the intended loud failure.
var mux = func() http.Handler {
	h, err := api.NewMux()
	if err != nil {
		panic(err)
	}
	return h
}()

// Handler is the sole Vercel Functions entry point for the Go API.
//
// vercel.json rewrites each /api/* route to /api/entry and carries the
// original path as ?_path=. Vercel sets r.URL.Path to the destination
// (/api/entry), so the original path is restored from _path before
// dispatch — the generated ServeMux patterns ("POST /api/services/{id}",
// …) match on the real path. Trailing slashes from empty wildcard
// matches (e.g. /api/services/ from :path*) are trimmed so collection
// routes match.
func Handler(w http.ResponseWriter, r *http.Request) {
	if orig := r.URL.Query().Get("_path"); orig != "" {
		// _path is an internal rewrite artifact, never a client input:
		// only /api/... prefixes are ever rewritten here, and anything
		// else is answered 404 rather than dispatched. It is also
		// stripped from RawQuery so handlers logging the URL do not
		// echo the artifact back.
		if !strings.HasPrefix(orig, "/api/") {
			http.NotFound(w, r)
			return
		}
		if orig != "/" {
			orig = strings.TrimSuffix(orig, "/")
		}
		r.URL.Path = orig
		r.URL.RawQuery = stripQueryParam(r.URL.RawQuery, "_path")
	}
	mux.ServeHTTP(w, r)
}

// stripQueryParam removes one key (and its value) from a raw query
// string, preserving the rest verbatim.
func stripQueryParam(rawQuery, key string) string {
	parts := strings.Split(rawQuery, "&")
	kept := parts[:0]
	for _, part := range parts {
		if k, _, ok := strings.Cut(part, "="); ok && k == key {
			continue
		}
		if part == key {
			continue
		}
		kept = append(kept, part)
	}
	return strings.Join(kept, "&")
}
