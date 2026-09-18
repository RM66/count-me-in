// Generated from packages/contracts via scripts/generate-contracts.ts. Contains only derived code; hand-written rules live in rules.go / refine.go / domain.go.
package contracts

import (
	"time"
)

// ── Shared Constants ────────────────────────────────────────────────────────
// Only what the Go side actually uses is emitted. Browser-only values (image
// decode limit, target sizes, WebP quality) and rule constants whose Go
// function is not ported stay in TypeScript — generating them here would be
// dead weight that can only drift.

// Demo account (ADR-010).
const (
	DemoOrganizerID       = "01930000-0000-7000-8000-0000000000de"
	DemoOrganizerSlug     = "demo"
	DemoReadOnlyCode      = "DEMO_READ_ONLY"
	DemoReadOnlyMessage   = "This is a read-only demo account — sign up to create your own bookable services."
	DemoServiceYoga       = "demo-yoga"
	DemoServicePottery    = "demo-pottery"
	DemoServiceBreathwork = "demo-breathwork"
)

// QStash queues (ADR-012).
const (
	QueueBookingCreated   = "booking.created"
	QueueBookingCancelled = "booking.cancelled"
	QueueDemoRefresh      = "demo.refresh"
)

// One-time login links. The prefix is generated from the TS constant, so the
// Go writer and the TS reader cannot disagree on the Redis key.
const (
	LoginLinkTTLSeconds = 2592000
	LoginLinkKeyPrefix  = "auth:login-link:"
)

// Slot validation tolerance.
const (
	SlotStartToleranceMS   = 60000
	SlotStartInPastMessage = "Pick a time in the future — guests cannot book a session that has already started"
)

// ── Enums ────────────────────────────────────────────────────────────────────

type BookingStatus string

const (
	BookingConfirmed BookingStatus = "confirmed"
	BookingCancelled BookingStatus = "cancelled"
)

type Messenger string

const (
	MessengerTelegram Messenger = "telegram"
)

type OptionsSelectMode string

const (
	OptionsSingle OptionsSelectMode = "single"
	OptionsMulti  OptionsSelectMode = "multi"
)

type NotificationRecipient string

const (
	RecipientOrganizer NotificationRecipient = "organizer"
	RecipientGuest     NotificationRecipient = "guest"
)

type CancelActor string

const (
	ActorGuest     CancelActor = "guest"
	ActorOrganizer CancelActor = "organizer"
)

// Locales — language switcher order.
var Locales = []string{"en", "de", "es", "fr", "pt", "ru", "ar", "ja"}

const DefaultLocale = "en"

// Auth.js session cookie names, https ("__Secure-"-prefixed, prod) first.
var SessionCookieNames = []string{"__Secure-authjs.session-token", "authjs.session-token"}

// ── Request Input Structs ───────────────────────────────────────────────────

type CreateBookingInput struct {
	ServiceID       string
	TimeSlotID      string
	Seats           int
	GuestName       string
	GuestTicket     string
	SelectedOptions []string
	GuestLocale     string
}

type CancelBookingByTokenInput struct {
	ManageToken string
}

type LookupBookingsInput struct {
	GuestTicket string
}

type CancelBookingByOrganizerInput struct {
	BookingID string
}

type CreateServiceInput struct {
	Title                  string
	Description            *string
	Location               *string
	Contact                *string
	DefaultPrice           string
	DefaultCapacity        int
	DefaultDurationMinutes int
	MaxSeatsPerBooking     int
	Options                []string
	OptionsSelectMode      *OptionsSelectMode
	PhotoURL               *string
}

type UpdateServiceInput struct {
	Title                  Optional[string]
	Description            Optional[string]
	Location               Optional[string]
	Contact                Optional[string]
	DefaultPrice           Optional[string]
	DefaultCapacity        Optional[int]
	DefaultDurationMinutes Optional[int]
	MaxSeatsPerBooking     Optional[int]
	Options                Optional[[]string]
	OptionsSelectMode      Optional[OptionsSelectMode]
	PhotoURL               Optional[string]
}

type CreateTimeSlotInput struct {
	ServiceID       string
	StartsAt        time.Time
	DurationMinutes int
	Capacity        int
	Price           *string
}

type UpdateTimeSlotInput struct {
	StartsAt        Optional[FlexTime]
	DurationMinutes Optional[int]
	Capacity        Optional[int]
	Price           Optional[string]
}

type RegisterOrganizerInput struct {
	Ticket   string
	Slug     string
	Name     string
	Timezone string
	Contact  *string
	Language string
}

type UpdateOrganizerProfileInput struct {
	Name        Optional[string]
	Slug        Optional[string]
	Timezone    Optional[string]
	Description Optional[string]
	Location    Optional[string]
	Contact     Optional[string]
	PhotoURL    Optional[string]
}

type UpdateOrganizerLanguageInput struct {
	Language string
}

type CreateAvatarUploadInput struct {
	ContentType string
	Size        int
}

type CreateServicePhotoUploadInput struct {
	ContentType string
	Size        int
}

type TelegramWidgetPayload struct {
	ID        int
	FirstName string
	LastName  *string
	Username  *string
	PhotoURL  *string
	AuthDate  int
	Hash      string
}

// ── Response DTOs & Records ─────────────────────────────────────────────────

type OrganizerProfile struct {
	ID          string    `json:"id"`
	Slug        string    `json:"slug"`
	Name        string    `json:"name"`
	Messenger   Messenger `json:"messenger"`
	MessengerID string    `json:"messengerId"`
	Timezone    string    `json:"timezone"`
	Description *string   `json:"description"`
	PhotoURL    *string   `json:"photoUrl"`
	Location    *string   `json:"location"`
	Contact     *string   `json:"contact"`
	Language    string    `json:"language"`
	CreatedAt   string    `json:"createdAt"`
	IsDemo      bool      `json:"isDemo"`
}

type PublicOrganizer struct {
	ID          string  `json:"id"`
	Slug        string  `json:"slug"`
	Name        string  `json:"name"`
	Timezone    string  `json:"timezone"`
	Description *string `json:"description"`
	PhotoURL    *string `json:"photoUrl"`
	Location    *string `json:"location"`
	Contact     *string `json:"contact"`
	IsDemo      bool    `json:"isDemo"`
}

type ServiceRecord struct {
	ID                     string             `json:"id"`
	OrganizerID            string             `json:"organizerId"`
	Title                  string             `json:"title"`
	Description            *string            `json:"description"`
	PhotoURL               *string            `json:"photoUrl"`
	Location               *string            `json:"location"`
	Contact                *string            `json:"contact"`
	DefaultPrice           string             `json:"defaultPrice"`
	DefaultCapacity        int                `json:"defaultCapacity"`
	DefaultDurationMinutes int                `json:"defaultDurationMinutes"`
	MaxSeatsPerBooking     int                `json:"maxSeatsPerBooking"`
	Options                []string           `json:"options"`
	OptionsSelectMode      *OptionsSelectMode `json:"optionsSelectMode"`
	CreatedAt              string             `json:"createdAt"`
}

type TimeSlotRecord struct {
	ID              string  `json:"id"`
	ServiceID       string  `json:"serviceId"`
	StartsAt        string  `json:"startsAt"`
	DurationMinutes int     `json:"durationMinutes"`
	Capacity        int     `json:"capacity"`
	BookedCount     int     `json:"bookedCount"`
	Price           *string `json:"price"`
	CreatedAt       string  `json:"createdAt"`
}

type BookingRecord struct {
	ID                  string        `json:"id"`
	TimeSlotID          string        `json:"timeSlotId"`
	Status              BookingStatus `json:"status"`
	Seats               int           `json:"seats"`
	GuestName           string        `json:"guestName"`
	GuestMessenger      Messenger     `json:"guestMessenger"`
	GuestMessengerID    string        `json:"guestMessengerId"`
	GuestMessengerLogin *string       `json:"guestMessengerLogin"`
	SelectedOptions     []string      `json:"selectedOptions"`
	CreatedAt           string        `json:"createdAt"`
}

type GuestBooking struct {
	ID              string          `json:"id"`
	Status          BookingStatus   `json:"status"`
	Seats           int             `json:"seats"`
	GuestName       string          `json:"guestName"`
	SelectedOptions []string        `json:"selectedOptions"`
	CreatedAt       string          `json:"createdAt"`
	ManageToken     string          `json:"manageToken"`
	Slot            TimeSlotRecord  `json:"slot"`
	Service         ServiceRecord   `json:"service"`
	Organizer       PublicOrganizer `json:"organizer"`
}

type ImageUploadTarget struct {
	UploadURL string `json:"uploadUrl"`
	PublicURL string `json:"publicUrl"`
	ExpiresAt string `json:"expiresAt"`
}

type RegisteredOrganizer struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
}

type Registered struct {
	Organizer RegisteredOrganizer `json:"organizer"`
}

type AuthTicketPayload struct {
	Messenger      Messenger `json:"messenger"`
	MessengerID    string    `json:"messengerId"`
	DisplayName    string    `json:"displayName"`
	PhotoURL       *string   `json:"photoUrl,omitempty"`
	MessengerLogin *string   `json:"messengerLogin,omitempty"`
}

type GuestTicketResponse struct {
	Ticket      string    `json:"ticket"`
	Messenger   Messenger `json:"messenger"`
	MessengerID string    `json:"messengerId"`
	DisplayName string    `json:"displayName"`
}

type AuthTicketResponse struct {
	Ticket          string `json:"ticket"`
	OrganizerExists bool   `json:"organizerExists"`
}

type LoginLinkPayload struct {
	OrganizerID string `json:"organizerId"`
	Next        string `json:"next"`
}

type BookingCreatedJob struct {
	BookingID string                `json:"bookingId"`
	Recipient NotificationRecipient `json:"recipient"`
}

type BookingCancelledJob struct {
	BookingID   string      `json:"bookingId"`
	CancelledBy CancelActor `json:"cancelledBy"`
}

type ServiceEnvelope struct {
	Service ServiceRecord `json:"service"`
}

type ServicesEnvelope struct {
	Services []ServiceRecord `json:"services"`
}

type SlotEnvelope struct {
	Slot TimeSlotRecord `json:"slot"`
}

type SlotsEnvelope struct {
	Slots []TimeSlotRecord `json:"slots"`
}

type GuestBookingEnvelope struct {
	Booking GuestBooking `json:"booking"`
}

type BookingEnvelope struct {
	Booking BookingRecord `json:"booking"`
}

type GuestBookingsEnvelope struct {
	Bookings []GuestBooking `json:"bookings"`
}

type OrganizerEnvelope struct {
	Organizer OrganizerProfile `json:"organizer"`
}

type DeletedServiceEnvelope struct {
	ID string `json:"id"`
}

type DeletedSlotEnvelope struct {
	ID string `json:"id"`
}

type ErrorBody struct {
	Error     string  `json:"error"`
	Code      *string `json:"code,omitempty"`
	SeatsLeft *int    `json:"seatsLeft,omitempty"`
	MaxSeats  *int    `json:"maxSeats,omitempty"`
}

type ValidationErrors struct {
	FormErrors  []string            `json:"formErrors"`
	FieldErrors map[string][]string `json:"fieldErrors"`
}

type InvalidBody struct {
	Error   string           `json:"error"`
	Details ValidationErrors `json:"details"`
}

type InvalidIssuesBody struct {
	Error  string              `json:"error"`
	Issues map[string][]string `json:"issues"`
}

var RecordNames = []string{"OrganizerProfile", "PublicOrganizer", "ServiceRecord", "TimeSlotRecord", "BookingRecord", "GuestBooking", "ImageUploadTarget", "RegisteredOrganizer", "Registered", "AuthTicketPayload", "GuestTicketResponse", "AuthTicketResponse", "LoginLinkPayload", "BookingCreatedJob", "BookingCancelledJob", "ServiceEnvelope", "ServicesEnvelope", "SlotEnvelope", "SlotsEnvelope", "GuestBookingEnvelope", "BookingEnvelope", "GuestBookingsEnvelope", "OrganizerEnvelope", "DeletedServiceEnvelope", "DeletedSlotEnvelope", "ErrorBody", "ValidationErrors", "InvalidBody", "InvalidIssuesBody"}

// ── API route manifest ──────────────────────────────────────────────────────

type RouteSpec struct {
	OperationID string
	Method      string
	Path        string
}

var APIRoutes = []RouteSpec{
	{OperationID: "telegramGuest", Method: "POST", Path: "/api/auth/telegram-guest"},
	{OperationID: "telegramSignup", Method: "POST", Path: "/api/auth/telegram-signup"},
	{OperationID: "registerOrganizer", Method: "POST", Path: "/api/organizers"},
	{OperationID: "getMyProfile", Method: "GET", Path: "/api/organizers/me"},
	{OperationID: "updateMyProfile", Method: "PUT", Path: "/api/organizers/me"},
	{OperationID: "updateMyLanguage", Method: "PATCH", Path: "/api/organizers/me/language"},
	{OperationID: "createAvatarUploadTarget", Method: "POST", Path: "/api/organizers/me/avatar"},
	{OperationID: "createServicePhotoUploadTarget", Method: "POST", Path: "/api/organizers/me/service-photo"},
	{OperationID: "listServices", Method: "GET", Path: "/api/services"},
	{OperationID: "createService", Method: "POST", Path: "/api/services"},
	{OperationID: "getService", Method: "GET", Path: "/api/services/{id}"},
	{OperationID: "updateService", Method: "PUT", Path: "/api/services/{id}"},
	{OperationID: "deleteService", Method: "DELETE", Path: "/api/services/{id}"},
	{OperationID: "listSlots", Method: "GET", Path: "/api/slots"},
	{OperationID: "createSlot", Method: "POST", Path: "/api/slots"},
	{OperationID: "getSlot", Method: "GET", Path: "/api/slots/{id}"},
	{OperationID: "updateSlot", Method: "PUT", Path: "/api/slots/{id}"},
	{OperationID: "deleteSlot", Method: "DELETE", Path: "/api/slots/{id}"},
	{OperationID: "createBooking", Method: "POST", Path: "/api/bookings"},
	{OperationID: "lookupBookings", Method: "POST", Path: "/api/bookings/lookup"},
	{OperationID: "cancelBookingByToken", Method: "POST", Path: "/api/bookings/cancel"},
	{OperationID: "cancelBookingByOrganizer", Method: "POST", Path: "/api/bookings/cancel-by-organizer"},
	{OperationID: "runJob", Method: "POST", Path: "/api/jobs/{queue}"},
}
