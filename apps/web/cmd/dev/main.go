// cmd/dev is a local development server for the Go API: it mounts the
// same route handlers the Vercel functions use (internal/routes) on a
// plain net/http mux, so the API can run next to `next dev` without
// the Vercel CLI. Production traffic never flows through this binary —
// Vercel compiles each api/ entry file into its own function.
//
// Dynamic route dirs use plain names (by-id, by-queue) because Go
// rejects '[' in import paths — vercel.json rewrites map :id / :queue
// to them in production. The route logic lives in internal/routes and
// the entry files are thin wrappers.
package main

import (
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"countmein/internal/httpx"
	"countmein/internal/routes"
)

func main() {
	loadDotEnv(".env")

	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/telegram-guest", httpx.Recover(routes.TelegramGuest))
	mux.HandleFunc("/api/auth/telegram-signup", httpx.Recover(routes.TelegramSignup))
	mux.HandleFunc("/api/organizers", httpx.Recover(routes.OrganizerRegister))
	mux.HandleFunc("/api/organizers/me", httpx.Recover(routes.OrganizerMe))
	mux.HandleFunc("/api/organizers/me/avatar", httpx.Recover(routes.OrganizerAvatar))
	mux.HandleFunc("/api/organizers/me/service-photo", httpx.Recover(routes.OrganizerServicePhoto))
	mux.HandleFunc("/api/services", httpx.Recover(routes.ServicesCollection))
	mux.HandleFunc("/api/services/{id}", httpx.Recover(routes.ServiceItem))
	mux.HandleFunc("/api/slots", httpx.Recover(routes.SlotsCollection))
	mux.HandleFunc("/api/slots/{id}", httpx.Recover(routes.SlotItem))
	mux.HandleFunc("/api/bookings", httpx.Recover(routes.BookingCreate))
	mux.HandleFunc("/api/bookings/lookup", httpx.Recover(routes.BookingLookup))
	mux.HandleFunc("/api/bookings/cancel", httpx.Recover(routes.BookingCancel))
	mux.HandleFunc("/api/bookings/cancel-by-organizer", httpx.Recover(routes.BookingCancelByOrganizer))
	mux.HandleFunc("/api/jobs/{queue}", httpx.Recover(routes.JobsReceiver))

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
