package contracts

import "time"

// Response DTOs — one shape per audience, mirroring the Zod record
// schemas in @repo/contracts (camelCase keys, ISO date strings,
// explicit nulls). Nullable fields are pointers without omitempty so
// they serialize as null, matching the TS mappers.

type OrganizerProfile struct {
	ID          string  `json:"id"`
	Slug        string  `json:"slug"`
	Name        string  `json:"name"`
	Messenger   string  `json:"messenger"`
	MessengerID string  `json:"messengerId"`
	Timezone    string  `json:"timezone"`
	Description *string `json:"description"`
	PhotoURL    *string `json:"photoUrl"`
	Location    *string `json:"location"`
	Contact     *string `json:"contact"`
	Language    string  `json:"language"`
	CreatedAt   string  `json:"createdAt"`
	// Derived server-side from DEMO_ORGANIZER_ID, never a column.
	IsDemo bool `json:"isDemo"`
}

// PublicOrganizer is the public-page projection of an organizer:
// messenger identity (the login credential) and createdAt never cross.
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
	ID                     string   `json:"id"`
	OrganizerID            string   `json:"organizerId"`
	Title                  string   `json:"title"`
	Description            *string  `json:"description"`
	PhotoURL               *string  `json:"photoUrl"`
	Location               *string  `json:"location"`
	Contact                *string  `json:"contact"`
	DefaultPrice           string   `json:"defaultPrice"`
	DefaultCapacity        int      `json:"defaultCapacity"`
	DefaultDurationMinutes int      `json:"defaultDurationMinutes"`
	MaxSeatsPerBooking     int      `json:"maxSeatsPerBooking"`
	Options                []string `json:"options"`
	OptionsSelectMode      *string  `json:"optionsSelectMode"`
	CreatedAt              string   `json:"createdAt"`
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

// BookingRecord — the organizer's cabinet view. manageToken is
// deliberately absent: it is the guest's cancellation secret.
type BookingRecord struct {
	ID                  string   `json:"id"`
	TimeSlotID          string   `json:"timeSlotId"`
	Status              string   `json:"status"`
	Seats               int      `json:"seats"`
	GuestName           string   `json:"guestName"`
	GuestMessenger      string   `json:"guestMessenger"`
	GuestMessengerID    string   `json:"guestMessengerId"`
	GuestMessengerLogin *string  `json:"guestMessengerLogin"`
	SelectedOptions     []string `json:"selectedOptions"`
	CreatedAt           string   `json:"createdAt"`
}

// GuestBooking — the guest's own booking; keeps manageToken because
// that token is their key to /booking/{manageToken}.
type GuestBooking struct {
	ID              string          `json:"id"`
	Status          string          `json:"status"`
	Seats           int             `json:"seats"`
	GuestName       string          `json:"guestName"`
	SelectedOptions []string        `json:"selectedOptions"`
	CreatedAt       string          `json:"createdAt"`
	ManageToken     string          `json:"manageToken"`
	Slot            TimeSlotRecord  `json:"slot"`
	Service         ServiceRecord   `json:"service"`
	Organizer       PublicOrganizer `json:"organizer"`
}

// AvatarUploadTarget / ImageUploadTarget — the signed-upload
// handshake shape shared by avatars and service covers.
type ImageUploadTarget struct {
	UploadURL string `json:"uploadUrl"`
	PublicURL string `json:"publicUrl"`
	ExpiresAt string `json:"expiresAt"`
}

// RegisteredOrganizer is POST /api/organizers' 201 body.
type RegisteredOrganizer struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
}

// Registered is the wrapper for RegisteredOrganizer on the wire.
type Registered struct {
	Organizer RegisteredOrganizer `json:"organizer"`
}

func ISO(t time.Time) string { return ISODate(t) }
