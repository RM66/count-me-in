// cmd/dev is a local development server for the Go API: it mounts the
// same shared mux the Vercel entry point uses (pkg/routes.NewMux) on a
// plain net/http server, so the API runs next to `next dev` without the
// Vercel CLI. Production traffic flows through the single function at
// api/entry/index.go; this binary is never deployed. Sharing NewMux
// guarantees dev and prod dispatch identically — the only difference is
// how a request reaches the mux (Vercel rewrites vs. ListenAndServe).
package main

import (
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"countmein/pkg/routes"
)

func main() {
	loadDotEnv(".env")

	mux := routes.NewMux()

	addr := ":" + envOr("PORT", "3001")
	log.Printf("api-go dev server on http://localhost%s (routes: /api/*)", addr)
	log.Fatal(http.ListenAndServe(addr, withRequestsLogged(mux)))
}

// withRequestsLogged prints one line per request — the visible proof
// during local cutover testing of which side (Go vs TS) served a call.
func withRequestsLogged(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s (%s)", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
	})
}

func envOr(name, def string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return def
}

// loadDotEnv reads KEY=VALUE lines from path (the module-root .env
// symlink) into the environment; values already set in the real
// environment win. Dev-only convenience — Go has no built-in .env
// support and the serverless functions get their env from Vercel.
func loadDotEnv(path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return // no .env — rely on the real environment
	}
	for line := range strings.SplitSeq(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if key != "" && os.Getenv(key) == "" {
			_ = os.Setenv(key, value)
		}
	}
}
