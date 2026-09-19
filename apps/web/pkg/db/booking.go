package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"countmein/pkg/contracts"
	"countmein/pkg/demo"

	"github.com/jackc/pgx/v5"
)

// Server-side reads, writes and DTO mapping for bookings.
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
	SelectedOptions     []string
	CreatedAt           time.Time
	// When the manageToken stops being usable for cancellation
	// (architecture review fix #4). nil = non-expiring (legacy rows).
	ManageTokenExpiresAt *time.Time
}

// array_to_json projections make NULL arrays explicit.
const bookingColumns = `id, time_slot_id, status::text, seats, guest_name, guest_messenger::text, guest_messenger_id, guest_messenger_login, guest_locale, manage_token, array_to_json(selected_options), created_at, manage_token_expires_at`

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

// ManageTokenExpiredError — the manageToken is past its expiry
// (architecture review fix #4). A past event's booking no longer needs
// cancel access; the token is answered like an unknown one (404) so
// the endpoint cannot be used to test whether a token exists.
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
		&b.GuestMessengerID, &b.GuestMessengerLogin, &b.GuestLocale, &b.ManageToken, &optionsJSON,
		&b.CreatedAt, &b.ManageTokenExpiresAt)
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
  b.id, b.time_slot_id, b.status::text, b.seats, b.guest_name, b.guest_messenger::text, b.guest_messenger_id, b.guest_messenger_login, b.guest_locale, b.manage_token, array_to_json(b.selected_options), b.created_at, b.manage_token_expires_at,
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
		&b.ID, &b.TimeSlotID, &b.Status, &b.Seats, &b.GuestName, &b.GuestMessenger, &b.GuestMessengerID, &b.GuestMessengerLogin, &b.GuestLocale, &b.ManageToken, &bOptions, &b.CreatedAt, &b.ManageTokenExpiresAt,
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

func ToBookingRecord(b BookingRow) contracts.BookingRecord {
	return contracts.BookingRecord{
		ID:                  b.ID,
		TimeSlotID:          b.TimeSlotID,
		Status:              contracts.BookingStatus(b.Status),
		Seats:               b.Seats,
		GuestName:           b.GuestName,
		GuestMessenger:      contracts.Messenger(b.GuestMessenger),
		GuestMessengerID:    b.GuestMessengerID,
		GuestMessengerLogin: b.GuestMessengerLogin,
		SelectedOptions:     b.SelectedOptions,
		CreatedAt:           contracts.ISODate(b.CreatedAt),
	}
}

func ToGuestBooking(b BookingRow, slot TimeSlotRow, service ServiceRow, organizer OrganizerRow) contracts.GuestBooking {
	return contracts.GuestBooking{
		ID:              b.ID,
		Status:          contracts.BookingStatus(b.Status),
		Seats:           b.Seats,
		GuestName:       b.GuestName,
		SelectedOptions: b.SelectedOptions,
		CreatedAt:       contracts.ISODate(b.CreatedAt),
		ManageToken:     b.ManageToken,
		Slot:            ToTimeSlotRecord(slot),
		Service:         ToServiceRecord(service),
		Organizer:       ToPublicOrganizer(organizer),
	}
}

// ── Guest-facing reads ──────────────────────────────────────────────────────

// ListGuestBookings — every booking of one messenger identity, newest
// first (ADR-002, entry path 2). Cancelled bookings are included: a
// guest looking for "my bookings" is often checking whether a
// cancellation went through.
func ListGuestBookings(ctx context.Context, messenger, messengerID string) ([]contracts.GuestBooking, error) {
	rows, err := Pool().Query(ctx, bookingChainSelect+`
		WHERE b.guest_messenger = $1::messenger_kind AND b.guest_messenger_id = $2
		ORDER BY b.created_at DESC`, messenger, messengerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []contracts.GuestBooking{}
	for rows.Next() {
		b, slot, service, organizer, err := scanBookingChain(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, ToGuestBooking(*b, *slot, *service, *organizer))
	}
	return out, rows.Err()
}

// GetBookingChain — the fresh chain a notification job refetches at
// send time (jobs carry ids only). Raw rows, not DTOs: a notification
// needs the timezone, chat id, manageToken and display overrides.
func GetBookingChain(ctx context.Context, bookingID string) (*BookingRow, *TimeSlotRow, *ServiceRow, *OrganizerRow, error) {
	return scanBookingChain(Pool().QueryRow(ctx,
		bookingChainSelect+` WHERE b.id = $1::uuid LIMIT 1`, bookingID))
}

// ── Guest-facing writes ─────────────────────────────────────────────────────
//
// Seats move only through the atomic reserve below; the demo guard
// runs inside the transaction because these routes carry no session —
// the organizer is only known once the slot joins its service.

// CreateGuestBooking reserves seats and inserts the confirmed booking
// — the guest booking flow's one write (invariant 2).
//
// The seat claim is a single conditional UPDATE:
//
//	UPDATE time_slots SET booked_count = booked_count + :seats
//	WHERE id = :id AND booked_count + :seats <= capacity
//
// Postgres evaluates the predicate against the row it locks, so two
// concurrent bookings for the last seat cannot both succeed — one
// updates no row and is refused. The booking row is inserted only if
// that statement affected a row, and both live in one transaction: a
// claimed seat with no booking would be capacity lost forever, and a
// booking with no claim is an overbooking.
func CreateGuestBooking(ctx context.Context, data contracts.CreateBookingData) (*contracts.GuestBooking, error) {
	tx, err := Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(context.Background()) //nolint

	slot, service, organizer, err := scanSlotChain(tx.QueryRow(ctx,
		slotChainSelect+` WHERE ts.id = $1::uuid AND s.id = $2 LIMIT 1`, data.TimeSlotID, data.ServiceID))
	if err != nil {
		return nil, err
	}
	if slot == nil {
		return nil, SlotNotBookableError{}
	}

	if err := demo.AssertNotDemo(organizer.ID); err != nil {
		return nil, err
	}

	mode := contracts.OptionsMulti
	if service.OptionsSelectMode != nil && *service.OptionsSelectMode == string(contracts.OptionsSingle) {
		mode = contracts.OptionsSingle
	}
	selected, err := contracts.ValidateSelectedOptions(service.Options, mode, data.SelectedOptions)
	if err != nil {
		return nil, InvalidOptionSelectionError{Msg: err.Error()}
	}

	// Organizer's per-booking cap — enforced before the atomic reserve
	// so an oversized party is refused outright rather than competing
	// for seats.
	if data.Seats > service.MaxSeatsPerBooking {
		return nil, PartyTooLargeError{MaxSeats: service.MaxSeatsPerBooking}
	}

	var claimed TimeSlotRow
	err = tx.QueryRow(ctx, `
		UPDATE time_slots SET booked_count = booked_count + $1
		WHERE id = $2::uuid AND booked_count + $1 <= capacity
		RETURNING id, service_id, starts_at, duration_minutes, capacity, booked_count, price, created_at`,
		data.Seats, data.TimeSlotID,
	).Scan(&claimed.ID, &claimed.ServiceID, &claimed.StartsAt, &claimed.DurationMinutes,
		&claimed.Capacity, &claimed.BookedCount, &claimed.Price, &claimed.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		// No row claimed → sold out. seatsLeft is computed from the
		// chain-select snapshot (tx start) — under READ COMMITTED a
		// concurrent booking committed in between can make it stale by
		// a seat or two. Exact TS parity (it read the same snapshot),
		// and the number is UX copy, not an invariant.
		return nil, SlotSoldOutError{SeatsLeft: contracts.SeatsLeft(slot.Capacity, slot.BookedCount)}
	}
	if err != nil {
		return nil, err
	}

	// manageToken expiry (fix #4): the token is usable until the slot
	// starts plus a grace period — a past event's booking does not need
	// cancel access.
	expiresAt := claimed.StartsAt.Add(manageTokenGracePeriod)
	created, err := scanBooking(tx.QueryRow(ctx, `
		INSERT INTO bookings (id, time_slot_id, status, seats, guest_name, guest_messenger, guest_messenger_id,
			guest_messenger_login, guest_locale, manage_token, selected_options, manage_token_expires_at)
		VALUES ($1::uuid, $2::uuid, $3::booking_status, $4, $5, $6::messenger_kind, $7, $8, $9, $10, $11, $12)
		RETURNING `+bookingColumns,
		newID(), claimed.ID, "confirmed", data.Seats, data.GuestName,
		string(data.Guest.Messenger), data.Guest.MessengerID, data.Guest.MessengerLogin,
		data.GuestLocale, newManageToken(), nullableSlice(selected), expiresAt))
	if err != nil {
		// Duplicate booking — the transaction rolls back, releasing the
		// claimed seat (partial unique index, invariant 4).
		if UniqueViolation(err) != nil {
			return nil, DuplicateBookingError{}
		}
		return nil, err
	}
	if created == nil {
		return nil, SlotNotBookableError{}
	}

	// Transactional outbox (architecture review fix #3): write one
	// outbox row per recipient in the same transaction, so a crash
	// between commit and the inline publish does not lose the
	// notification — the sweeper re-publishes pending rows.
	if err := EnqueueOutbox(ctx, tx, contracts.QueueBookingCreated, contracts.BookingCreatedJob{
		BookingID: created.ID, Recipient: contracts.RecipientOrganizer,
	}); err != nil {
		return nil, err
	}
	if err := EnqueueOutbox(ctx, tx, contracts.QueueBookingCreated, contracts.BookingCreatedJob{
		BookingID: created.ID, Recipient: contracts.RecipientGuest,
	}); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	guest := ToGuestBooking(*created, claimed, *service, *organizer)
	return &guest, nil
}

// CancelGuestBookingByToken cancels by manageToken and releases the
// seats (ADR-002). Status flip and bookedCount decrement happen in one
// transaction — invariant 1: the counter equals the seats held by
// confirmed bookings. The status='confirmed' predicate makes this
// idempotent under a double-tap: the second call updates no row and is
// reported as already cancelled instead of decrementing twice.
// Returns nil for an unknown token (caller answers 404 without
// confirming whether the token exists).
func CancelGuestBookingByToken(ctx context.Context, token string) (*contracts.GuestBooking, error) {
	tx, err := Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(context.Background()) //nolint

	b, slot, service, organizer, err := scanBookingChain(tx.QueryRow(ctx,
		bookingChainSelect+` WHERE b.manage_token = $1 LIMIT 1`, token))
	if err != nil {
		return nil, err
	}
	if b == nil {
		return nil, nil
	}

	if err := demo.AssertNotDemo(organizer.ID); err != nil {
		return nil, err
	}

	// manageToken expiry (architecture review fix #4): a token past its
	// expiry is answered like an unknown one (nil → 404) so the endpoint
	// cannot be used to test whether a token exists. nil = non-expiring
	// (legacy rows created before the column was added).
	if b.ManageTokenExpiresAt != nil && time.Now().After(*b.ManageTokenExpiresAt) {
		return nil, ManageTokenExpiredError{}
	}

	cancelled, err := scanBooking(tx.QueryRow(ctx, `
		UPDATE bookings SET status = 'cancelled'
		WHERE id = $1::uuid AND status = 'confirmed'
		RETURNING `+bookingColumns, b.ID))
	if err != nil {
		return nil, err
	}
	if cancelled == nil {
		return nil, BookingAlreadyCancelledError{}
	}

	released, err := scanSlot(tx.QueryRow(ctx, `
		UPDATE time_slots SET booked_count = greatest(0, booked_count - $1)
		WHERE id = $2::uuid
		RETURNING `+slotColumns, cancelled.Seats, cancelled.TimeSlotID))
	if err != nil {
		return nil, err
	}
	if released == nil {
		released = slot // released can't vanish while the booking points at it
	}

	// Transactional outbox (architecture review fix #3): the organizer
	// is notified of the guest's cancellation. One row — the counterparty
	// only (ADR-012).
	if err := EnqueueOutbox(ctx, tx, contracts.QueueBookingCancelled, contracts.BookingCancelledJob{
		BookingID: cancelled.ID, CancelledBy: contracts.ActorGuest,
	}); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	guest := ToGuestBooking(*cancelled, *released, *service, *organizer)
	return &guest, nil
}

// ── Organizer-facing writes ──────────────────────────────────────────────────

// CancelOwnedBooking — the cabinet counterpart of CancelGuestBookingByToken:
// same state transition and seat release, reached by a different
// credential. The organizer proves ownership by owning the service the
// booking hangs off, so the id is scoped through ownedServiceIds.
// Returns the organizer's DTO, which drops manageToken: the cabinet
// must never receive it, even as a side effect.
func CancelOwnedBooking(ctx context.Context, organizerID, bookingID string) (*contracts.BookingRecord, error) {
	if err := demo.AssertNotDemo(organizerID); err != nil {
		return nil, err
	}

	tx, err := Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(context.Background()) //nolint

	// Unknown id and a booking on someone else's service are answered
	// identically, so the endpoint cannot probe for foreign ids.
	target, err := scanBooking(tx.QueryRow(ctx, `
		SELECT `+bookingColumns+` FROM bookings
		WHERE id = $1::uuid
		  AND time_slot_id IN (
		    SELECT ts.id FROM time_slots ts
		    INNER JOIN services s ON ts.service_id = s.id
		    WHERE s.organizer_id = $2::uuid
		  )
		LIMIT 1`, bookingID, organizerID))
	if err != nil {
		return nil, err
	}
	if target == nil {
		return nil, nil
	}

	cancelled, err := scanBooking(tx.QueryRow(ctx, `
		UPDATE bookings SET status = 'cancelled'
		WHERE id = $1::uuid AND status = 'confirmed'
		RETURNING `+bookingColumns, target.ID))
	if err != nil {
		return nil, err
	}
	if cancelled == nil {
		return nil, BookingAlreadyCancelledError{}
	}

	if _, err := tx.Exec(ctx, `
		UPDATE time_slots SET booked_count = greatest(0, booked_count - $1)
		WHERE id = $2::uuid`, cancelled.Seats, cancelled.TimeSlotID); err != nil {
		return nil, err
	}

	// Transactional outbox (architecture review fix #3): the guest is
	// notified of the organizer's cancellation. One row — the
	// counterparty only (ADR-012).
	if err := EnqueueOutbox(ctx, tx, contracts.QueueBookingCancelled, contracts.BookingCancelledJob{
		BookingID: cancelled.ID, CancelledBy: contracts.ActorOrganizer,
	}); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	record := ToBookingRecord(*cancelled)
	return &record, nil
}
