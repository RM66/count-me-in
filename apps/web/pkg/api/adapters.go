package api

import (
	"net/http"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/contracts"
	"countmein/pkg/httpx"
	"countmein/pkg/routes"
)

// adapters implements gen.ServerInterface by forwarding to the handlers in
// pkg/routes — one method per operation, no logic. Each forward is wrapped
// in httpx.Recover so a panic in one endpoint becomes a 500 instead of
// crashing the process.
//
// Path parameters come from the generated router (Go 1.22 method+path
// patterns) and are forwarded explicitly — they are authoritative, as is
// method routing: the router matches "POST /api/services" and never sends a
// GET to ServicesCreate, so the handlers carry no method or param fallbacks.
type adapters struct{}

// The generated ServerInterface is the contract: a signature change in the
// spec fails this assignment at compile time, before any test runs.
var _ gen.ServerInterface = (*adapters)(nil)

func newAdapters() *adapters { return &adapters{} }

// Auth (Telegram widget). The Auth.js routes (/api/auth/*) stay on
// Next.js; only the two widget endpoints live in the Go API.

func (adapters) TelegramGuest(w http.ResponseWriter, r *http.Request) {
	httpx.Recover(routes.TelegramGuest).ServeHTTP(w, r)
}

func (adapters) TelegramSignup(w http.ResponseWriter, r *http.Request) {
	httpx.Recover(routes.TelegramSignup).ServeHTTP(w, r)
}

// Bookings

func (adapters) CreateBooking(w http.ResponseWriter, r *http.Request) {
	httpx.Recover(routes.BookingCreate).ServeHTTP(w, r)
}

func (adapters) CancelBookingByToken(w http.ResponseWriter, r *http.Request) {
	httpx.Recover(routes.BookingCancel).ServeHTTP(w, r)
}

func (adapters) CancelBookingByOrganizer(w http.ResponseWriter, r *http.Request) {
	httpx.Recover(routes.BookingCancelByOrganizer).ServeHTTP(w, r)
}

func (adapters) LookupBookings(w http.ResponseWriter, r *http.Request) {
	httpx.Recover(routes.BookingLookup).ServeHTTP(w, r)
}

// QStash jobs. The queue is the generated enum type — the named Go
// constants come from the spec's enum, not from a re-parse of the path.

func (adapters) RunJob(w http.ResponseWriter, r *http.Request, queue gen.RunJobParamsQueue) {
	httpx.Recover(func(w http.ResponseWriter, r *http.Request) {
		routes.JobsReceiver(w, r, string(queue))
	}).ServeHTTP(w, r)
}

// Organizers

func (adapters) RegisterOrganizer(w http.ResponseWriter, r *http.Request) {
	httpx.Recover(routes.OrganizerRegister).ServeHTTP(w, r)
}

func (adapters) GetMyProfile(w http.ResponseWriter, r *http.Request) {
	httpx.Recover(routes.OrganizerMeGet).ServeHTTP(w, r)
}

func (adapters) UpdateMyProfile(w http.ResponseWriter, r *http.Request) {
	httpx.Recover(routes.OrganizerMePut).ServeHTTP(w, r)
}

func (adapters) UpdateMyLanguage(w http.ResponseWriter, r *http.Request) {
	httpx.Recover(routes.OrganizerMeLanguage).ServeHTTP(w, r)
}

func (adapters) CreateAvatarUploadTarget(w http.ResponseWriter, r *http.Request) {
	httpx.Recover(routes.OrganizerAvatar).ServeHTTP(w, r)
}

func (adapters) CreateServicePhotoUploadTarget(w http.ResponseWriter, r *http.Request) {
	httpx.Recover(routes.OrganizerServicePhoto).ServeHTTP(w, r)
}

// Services

func (adapters) ListServices(w http.ResponseWriter, r *http.Request) {
	httpx.Recover(routes.ServicesList).ServeHTTP(w, r)
}

func (adapters) CreateService(w http.ResponseWriter, r *http.Request) {
	httpx.Recover(routes.ServicesCreate).ServeHTTP(w, r)
}

func (adapters) GetService(w http.ResponseWriter, r *http.Request, id string) {
	httpx.Recover(func(w http.ResponseWriter, r *http.Request) {
		routes.ServiceGet(w, r, id)
	}).ServeHTTP(w, r)
}

func (adapters) UpdateService(w http.ResponseWriter, r *http.Request, id string) {
	httpx.Recover(func(w http.ResponseWriter, r *http.Request) {
		routes.ServicePut(w, r, id)
	}).ServeHTTP(w, r)
}

func (adapters) DeleteService(w http.ResponseWriter, r *http.Request, id string) {
	httpx.Recover(func(w http.ResponseWriter, r *http.Request) {
		routes.ServiceDelete(w, r, id)
	}).ServeHTTP(w, r)
}

// Time slots. `params` carries the parsed ?upcoming from the spec; the
// handlers never re-read the query string.

func (adapters) ListSlots(w http.ResponseWriter, r *http.Request, params gen.ListSlotsParams) {
	httpx.Recover(func(w http.ResponseWriter, r *http.Request) {
		routes.SlotsList(w, r, params)
	}).ServeHTTP(w, r)
}

func (adapters) CreateSlot(w http.ResponseWriter, r *http.Request) {
	httpx.Recover(routes.SlotsCreate).ServeHTTP(w, r)
}

func (adapters) GetSlot(w http.ResponseWriter, r *http.Request, id gen.UUID) {
	httpx.Recover(func(w http.ResponseWriter, r *http.Request) {
		routes.SlotGet(w, r, contracts.UUIDString(id))
	}).ServeHTTP(w, r)
}

func (adapters) UpdateSlot(w http.ResponseWriter, r *http.Request, id gen.UUID) {
	httpx.Recover(func(w http.ResponseWriter, r *http.Request) {
		routes.SlotPut(w, r, contracts.UUIDString(id))
	}).ServeHTTP(w, r)
}

func (adapters) DeleteSlot(w http.ResponseWriter, r *http.Request, id gen.UUID) {
	httpx.Recover(func(w http.ResponseWriter, r *http.Request) {
		routes.SlotDelete(w, r, contracts.UUIDString(id))
	}).ServeHTTP(w, r)
}
