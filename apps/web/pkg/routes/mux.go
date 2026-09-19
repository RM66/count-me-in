// Package routes holds the actual route logic for every API endpoint and
// the single shared mux that wires them. Both the Vercel entry point
// (api/entry/index.go) and the local dev server (cmd/dev) mount the same
// NewMux, so dev and prod dispatch identically — the only difference is
// how the request reaches the mux (Vercel rewrites vs. a direct
// ListenAndServe).
//
// Go 1.22+ http.ServeMux patterns carry the {id} / {queue} path
// parameters; httpx.PathParam reads them from the path in dev and from
// the ?id / ?queue query param in production (Vercel rewrites inject the
// captured segment as a query parameter).
package routes

import (
	"net/http"

	"countmein/pkg/httpx"
)

// NewMux creates and configures a net/http.ServeMux with every Go API
// route registered. Each handler is wrapped in httpx.Recover so a panic
// in one endpoint becomes a 500 instead of crashing the whole process —
// important now that a single function serves every route.
func NewMux() *http.ServeMux {
	mux := http.NewServeMux()

	// Auth (Telegram widget). The Auth.js routes (/api/auth/*) stay on
	// Next.js; only the two widget endpoints live in the Go API.
	mux.HandleFunc("/api/auth/telegram-guest", httpx.Recover(TelegramGuest))
	mux.HandleFunc("/api/auth/telegram-signup", httpx.Recover(TelegramSignup))

	// Organizers
	mux.HandleFunc("/api/organizers", httpx.Recover(OrganizerRegister))
	mux.HandleFunc("/api/organizers/me", httpx.Recover(OrganizerMe))
	mux.HandleFunc("/api/organizers/me/language", httpx.Recover(OrganizerMeLanguage))
	mux.HandleFunc("/api/organizers/me/avatar", httpx.Recover(OrganizerAvatar))
	mux.HandleFunc("/api/organizers/me/service-photo", httpx.Recover(OrganizerServicePhoto))

	// Services
	mux.HandleFunc("/api/services", httpx.Recover(ServicesCollection))
	mux.HandleFunc("/api/services/{id}", httpx.Recover(ServiceItem))

	// Slots
	mux.HandleFunc("/api/slots", httpx.Recover(SlotsCollection))
	mux.HandleFunc("/api/slots/{id}", httpx.Recover(SlotItem))

	// Bookings
	mux.HandleFunc("/api/bookings", httpx.Recover(BookingCreate))
	mux.HandleFunc("/api/bookings/lookup", httpx.Recover(BookingLookup))
	mux.HandleFunc("/api/bookings/cancel", httpx.Recover(BookingCancel))
	mux.HandleFunc("/api/bookings/cancel-by-organizer", httpx.Recover(BookingCancelByOrganizer))

	// QStash Jobs
	mux.HandleFunc("/api/jobs/{queue}", httpx.Recover(JobsReceiver))

	return mux
}
