package contracts

import "time"

// Request input structs — validated shapes produced by pkg/validation,
// consumed by pkg/db. Optional fields use Optional[T]; nullable ones
// (absent = leave unchanged, null = clear) use Optional with Value=nil.

type CreateBookingInput struct {
	ServiceID       string
	TimeSlotID      string
	Seats           int
	GuestName       string
	GuestTicket     string
	SelectedOptions []string
	GuestLocale     string
}

// CreateBookingData is what db.CreateGuestBooking takes: the identity
// comes from the consumed ticket server-side, never from the body.
type CreateBookingData struct {
	ServiceID       string
	TimeSlotID      string
	Seats           int
	GuestName       string
	SelectedOptions []string
	GuestLocale     string
	Guest           AuthTicketPayload
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
	Options                []string // nil = absent
	OptionsSelectMode      *string  // nil = absent
	PhotoURL               *string
}

// UpdateServiceInput — every field optional; Set&&Value==nil clears it.
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
	OptionsSelectMode      Optional[string]
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
	Price           Optional[string] // Set&&Value==nil clears the override
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
	PhotoURL    Optional[string] // Set&&Value==nil removes the avatar
}

type CreateAvatarUploadInput struct {
	ContentType string
	Size        int
}

type CreateServicePhotoUploadInput struct {
	ContentType string
	Size        int
}
