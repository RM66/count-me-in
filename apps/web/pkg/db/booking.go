package db

import (
	"errors"
	"fmt"
	"time"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/contracts"

	"github.com/jackc/pgx/v5"
)

// Booking entity: row types, failure modes, chain scans and DTO mapping.
// Reads live in booking_reads.go, writes in booking_writes.go.
//
// Ownership is transitive: there is no organizerId on bookings — a
// booking belongs to a slot, the slot to a service, the service to an
// organizer. Every read scopes through the parent chain.
//
// Two audiences, two DTOs: BookingRecord is the organizer's view and
// drops manageToken; GuestBooking is the guest's own booking and
// keeps it, because that token is their link to the management page.

type BookingRow struct {
	ID                  string
	TimeSlotID          string
	Status              string
	Seats               int
	GuestName           string
	GuestMessenger      string
	GuestMessengerID    string
	GuestMessengerLogin *string
	GuestLocale         string
	ManageToken         string
	// SHA-256 hex of ManageToken — the lookup key for credential checks.
	// The raw token stays on the row only for
	// the flows that re-issue the deep link.
	ManageTokenHash      string
	SelectedOptions      []string
	CreatedAt            time.Time
	ManageTokenExpiresAt *time.Time
}

// array_to_json projections make NULL arrays explicit.
const bookingColumns = `id, time_slot_id, status::text, seats, guest_name, guest_messenger::text, guest_messenger_id, guest_messenger_login, guest_locale, manage_token, manage_token_hash, array_to_json(selected_options), created_at, manage_token_expires_at`

// ── Failure modes (English messages for logs; the response body gets
// localized copy + machine-readable extras — ADR-011). ─────────────────

// SlotSoldOutError — the slot no longer has room for the requested seats.
type SlotSoldOutError struct {
	SeatsLeft int
}

func (e SlotSoldOutError) Error() string {
	if e.SeatsLeft == 0 {
		return "This session is fully booked"
	}
	if e.SeatsLeft == 1 {
		return "Only 1 seat left on this session"
	}
	return fmt.Sprintf("Only %d seats left on this session", e.SeatsLeft)
}

// SlotNotBookableError — the slot does not exist, or not under the service.
type SlotNotBookableError struct{}

func (SlotNotBookableError) Error() string { return "This session is no longer available" }

// InvalidOptionSelectionError — selectedOptions is not a valid
// selection for the service (invariant 6).
type InvalidOptionSelectionError struct {
	Msg string
}

func (e InvalidOptionSelectionError) Error() string { return e.Msg }

// PartyTooLargeError — more seats than the service allows one guest to
// claim at once (services.maxSeatsPerBooking); distinct from
// SlotSoldOutError, which is about the slot running out of room.
type PartyTooLargeError struct {
	MaxSeats int
}

func (e PartyTooLargeError) Error() string {
	if e.MaxSeats == 1 {
		return "You can book at most 1 seat in a single booking"
	}
	return fmt.Sprintf("You can book at most %d seats in a single booking", e.MaxSeats)
}

// BookingAlreadyCancelledError — cancel called on a cancelled booking.
type BookingAlreadyCancelledError struct{}

func (BookingAlreadyCancelledError) Error() string { return "This booking has already been cancelled" }

// DuplicateBookingError — the guest already has a confirmed booking on
// the same slot (partial unique index rejects the second INSERT with a
// 23505; cancelling and re-booking stays allowed).
type DuplicateBookingError struct{}

func (DuplicateBookingError) Error() string { return "You already have a booking for this session" }

// ManageTokenExpiredError — the manageToken is past its expiry.
// A past event's booking no longer needs
// cancel access; the token is answered like an unknown one (404) so the
// endpoint cannot be used to test whether a token exists.
type ManageTokenExpiredError struct{}

func (ManageTokenExpiredError) Error() string { return "This booking can no longer be cancelled" }

// manageTokenGracePeriod — how long after the slot starts the token stays
// usable. A guest may need to cancel shortly after the session begins
// (ran late, wrong day); 24h covers that without making the token
// permanent.
const manageTokenGracePeriod = 24 * time.Hour

// ── Scans and chain queries ─────────────────────────────────────────────────

func scanBooking(row pgx.Row) (*BookingRow, error) {
	var b BookingRow
	var optionsJSON *string
	err := row.Scan(&b.ID, &b.TimeSlotID, &b.Status, &b.Seats, &b.GuestName, &b.GuestMessenger,
		&b.GuestMessengerID, &b.GuestMessengerLogin, &b.GuestLocale, &b.ManageToken, &b.ManageTokenHash,
		&optionsJSON, &b.CreatedAt, &b.ManageTokenExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	b.SelectedOptions = parseStringArray(optionsJSON)
	return &b, nil
}

// slotChainSelect — the TimeSlot → Service → Organizer chain (no
// bookings): what CreateGuestBooking needs before it has a booking.
const slotChainSelect = `
SELECT
  ts.id, ts.service_id, ts.starts_at, ts.duration_minutes, ts.capacity, ts.booked_count, ts.price, ts.created_at,
  s.id, s.organizer_id, s.title, s.description, s.photo_url, s.location, s.contact, s.default_price,
  s.default_capacity, s.default_duration_minutes, s.max_seats_per_booking, array_to_json(s.options), s.options_select_mode::text, s.created_at,
  o.id, o.slug, o.name, o.messenger::text, o.messenger_id, o.timezone, o.language, o.description, o.photo_url, o.location, o.contact, o.created_at
FROM time_slots ts
JOIN services s ON ts.service_id = s.id
JOIN organizers o ON s.organizer_id = o.id
`

// bookingChainSelect — the Booking → TimeSlot → Service → Organizer
// chain in one statement: every guest-facing read needs all four.
const bookingChainSelect = `
SELECT
  b.id, b.time_slot_id, b.status::text, b.seats, b.guest_name, b.guest_messenger::text, b.guest_messenger_id, b.guest_messenger_login, b.guest_locale, b.manage_token, b.manage_token_hash, array_to_json(b.selected_options), b.created_at, b.manage_token_expires_at,
  ts.id, ts.service_id, ts.starts_at, ts.duration_minutes, ts.capacity, ts.booked_count, ts.price, ts.created_at,
  s.id, s.organizer_id, s.title, s.description, s.photo_url, s.location, s.contact, s.default_price,
  s.default_capacity, s.default_duration_minutes, s.max_seats_per_booking, array_to_json(s.options), s.options_select_mode::text, s.created_at,
  o.id, o.slug, o.name, o.messenger::text, o.messenger_id, o.timezone, o.language, o.description, o.photo_url, o.location, o.contact, o.created_at
FROM bookings b
JOIN time_slots ts ON b.time_slot_id = ts.id
JOIN services s ON ts.service_id = s.id
JOIN organizers o ON s.organizer_id = o.id
`

func scanSlotChain(row pgx.Row) (*TimeSlotRow, *ServiceRow, *OrganizerRow, error) {
	var slot TimeSlotRow
	var service ServiceRow
	var organizer OrganizerRow
	var optionsJSON *string
	err := row.Scan(
		&slot.ID, &slot.ServiceID, &slot.StartsAt, &slot.DurationMinutes, &slot.Capacity, &slot.BookedCount, &slot.Price, &slot.CreatedAt,
		&service.ID, &service.OrganizerID, &service.Title, &service.Description, &service.PhotoURL, &service.Location, &service.Contact, &service.DefaultPrice,
		&service.DefaultCapacity, &service.DefaultDurationMinutes, &service.MaxSeatsPerBooking, &optionsJSON, &service.OptionsSelectMode, &service.CreatedAt,
		&organizer.ID, &organizer.Slug, &organizer.Name, &organizer.Messenger, &organizer.MessengerID, &organizer.Timezone, &organizer.Language,
		&organizer.Description, &organizer.PhotoURL, &organizer.Location, &organizer.Contact, &organizer.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil, nil
	}
	if err != nil {
		return nil, nil, nil, err
	}
	service.Options = parseStringArray(optionsJSON)
	return &slot, &service, &organizer, nil
}

func scanBookingChain(row pgx.Row) (*BookingRow, *TimeSlotRow, *ServiceRow, *OrganizerRow, error) {
	var b BookingRow
	var slot TimeSlotRow
	var service ServiceRow
	var organizer OrganizerRow
	var bOptions, sOptions *string
	err := row.Scan(
		&b.ID, &b.TimeSlotID, &b.Status, &b.Seats, &b.GuestName, &b.GuestMessenger, &b.GuestMessengerID, &b.GuestMessengerLogin, &b.GuestLocale, &b.ManageToken, &b.ManageTokenHash, &bOptions, &b.CreatedAt, &b.ManageTokenExpiresAt,
		&slot.ID, &slot.ServiceID, &slot.StartsAt, &slot.DurationMinutes, &slot.Capacity, &slot.BookedCount, &slot.Price, &slot.CreatedAt,
		&service.ID, &service.OrganizerID, &service.Title, &service.Description, &service.PhotoURL, &service.Location, &service.Contact, &service.DefaultPrice,
		&service.DefaultCapacity, &service.DefaultDurationMinutes, &service.MaxSeatsPerBooking, &sOptions, &service.OptionsSelectMode, &service.CreatedAt,
		&organizer.ID, &organizer.Slug, &organizer.Name, &organizer.Messenger, &organizer.MessengerID, &organizer.Timezone, &organizer.Language,
		&organizer.Description, &organizer.PhotoURL, &organizer.Location, &organizer.Contact, &organizer.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil, nil, nil
	}
	if err != nil {
		return nil, nil, nil, nil, err
	}
	b.SelectedOptions = parseStringArray(bOptions)
	service.Options = parseStringArray(sOptions)
	return &b, &slot, &service, &organizer, nil
}

func ToBookingRecord(b BookingRow) gen.BookingRecord {
	return gen.BookingRecord{
		ID:                  contracts.ToUUID(b.ID),
		TimeSlotID:          contracts.ToUUID(b.TimeSlotID),
		Status:              gen.BookingStatus(b.Status),
		Seats:               b.Seats,
		GuestName:           b.GuestName,
		GuestMessenger:      gen.Messenger(b.GuestMessenger),
		GuestMessengerID:    b.GuestMessengerID,
		GuestMessengerLogin: b.GuestMessengerLogin,
		SelectedOptions:     strSlicePtr(b.SelectedOptions),
		CreatedAt:           contracts.ISODate(b.CreatedAt),
	}
}

func ToGuestBooking(b BookingRow, slot TimeSlotRow, service ServiceRow, organizer OrganizerRow) gen.GuestBooking {
	return gen.GuestBooking{
		ID:              contracts.ToUUID(b.ID),
		Status:          gen.BookingStatus(b.Status),
		Seats:           b.Seats,
		GuestName:       b.GuestName,
		SelectedOptions: strSlicePtr(b.SelectedOptions),
		CreatedAt:       contracts.ISODate(b.CreatedAt),
		ManageToken:     b.ManageToken,
		Slot:            ToTimeSlotRecord(slot),
		Service:         ToServiceRecord(service),
		Organizer:       ToPublicOrganizer(organizer),
	}
}
