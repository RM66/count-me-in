package db

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/contracts"
	"countmein/pkg/demo"

	"github.com/jackc/pgx/v5"
)

// Server-side reads, writes and DTO mapping for services. Every write
// is owner-scoped: organizerId sits in the WHERE clause rather than
// being checked by a preceding SELECT, so a foreign id matches no row
// and there is no read-then-write gap to exploit.

type ServiceRow struct {
	ID                     string
	OrganizerID            string
	Title                  string
	Description            *string
	PhotoURL               *string
	Location               *string
	Contact                *string
	DefaultPrice           string
	DefaultCapacity        int
	DefaultDurationMinutes int
	MaxSeatsPerBooking     int
	Options                []string
	OptionsSelectMode      *string
	CreatedAt              time.Time
}

// array_to_json projection makes NULL arrays explicit (nil *string).
const serviceColumns = `id, organizer_id, title, description, photo_url, location, contact, default_price, default_capacity, default_duration_minutes, max_seats_per_booking, array_to_json(options), options_select_mode::text, created_at`

func scanService(row pgx.Row) (*ServiceRow, error) {
	var s ServiceRow
	var optionsJSON *string
	err := row.Scan(&s.ID, &s.OrganizerID, &s.Title, &s.Description, &s.PhotoURL, &s.Location, &s.Contact,
		&s.DefaultPrice, &s.DefaultCapacity, &s.DefaultDurationMinutes, &s.MaxSeatsPerBooking,
		&optionsJSON, &s.OptionsSelectMode, &s.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	s.Options = parseStringArray(optionsJSON)
	return &s, nil
}

func ToServiceRecord(s ServiceRow) gen.ServiceRecord {
	var mode *gen.OptionsSelectMode
	if s.OptionsSelectMode != nil {
		m := gen.OptionsSelectMode(*s.OptionsSelectMode)
		mode = &m
	}
	return gen.ServiceRecord{
		ID:                     s.ID,
		OrganizerID:            contracts.ToUUID(s.OrganizerID),
		Title:                  s.Title,
		Description:            s.Description,
		PhotoURL:               s.PhotoURL,
		Location:               s.Location,
		Contact:                s.Contact,
		DefaultPrice:           s.DefaultPrice,
		DefaultCapacity:        s.DefaultCapacity,
		DefaultDurationMinutes: s.DefaultDurationMinutes,
		MaxSeatsPerBooking:     s.MaxSeatsPerBooking,
		Options:                strSlicePtr(s.Options),
		OptionsSelectMode:      mode,
		CreatedAt:              contracts.ISODate(s.CreatedAt),
	}
}

// ListServices — all services of an organizer, oldest first.
func ListServices(ctx context.Context, organizerID string) ([]ServiceRow, error) {
	rows, err := Pool().Query(ctx,
		`SELECT `+serviceColumns+` FROM services WHERE organizer_id = $1::uuid ORDER BY created_at ASC LIMIT 200`,
		organizerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ServiceRow{}
	for rows.Next() {
		s, err := scanService(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

// GetOwnedService — nil when the id does not exist *or* belongs to
// someone else, so callers cannot leak another organizer's service by
// guessing ids. Ownership sits in the WHERE clause like every sibling
// query (the TS version compared in JS; same observable behavior).
func GetOwnedService(ctx context.Context, organizerID, serviceID string) (*ServiceRow, error) {
	return GetOwnedServiceTx(ctx, Pool(), organizerID, serviceID)
}

// GetOwnedServiceTx is GetOwnedService on a caller-supplied querier
// (merge-patch transaction, P2).
func GetOwnedServiceTx(ctx context.Context, q Querier, organizerID, serviceID string) (*ServiceRow, error) {
	return scanService(q.QueryRow(ctx,
		`SELECT `+serviceColumns+` FROM services WHERE id = $1 AND organizer_id = $2::uuid LIMIT 1`,
		serviceID, organizerID))
}

// CreateService — the owner always comes from the session, never the
// payload; optional columns are normalized to null.
func CreateService(ctx context.Context, organizerID string, input gen.CreateServiceInput) (*ServiceRow, error) {
	if err := demo.AssertNotDemo(organizerID); err != nil {
		return nil, err
	}
	id := newServiceID()
	var modeStr *string
	if input.OptionsSelectMode != nil {
		s := string(*input.OptionsSelectMode)
		modeStr = &s
	}
	var options any
	if input.Options != nil {
		options = *input.Options
	}
	row := Pool().QueryRow(ctx, `
		INSERT INTO services (id, organizer_id, title, description, photo_url, location, contact,
			default_price, default_capacity, default_duration_minutes, max_seats_per_booking,
			options, options_select_mode)
		VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::options_select_mode)
		RETURNING `+serviceColumns,
		id, organizerID, input.Title, input.Description, input.PhotoURL, input.Location, input.Contact,
		input.DefaultPrice, input.DefaultCapacity, input.DefaultDurationMinutes, input.MaxSeatsPerBooking,
		options, modeStr)
	return scanService(row)
}

// NoServiceUpdatesError — the update payload contains no writable field.
type NoServiceUpdatesError struct{}

func (NoServiceUpdatesError) Error() string { return "No fields to update" }

// ServiceUpdate carries the merged state and the set of keys the patch
// touched, so the UPDATE writes only the columns the client intended to
// change (RFC 7386 merge-patch, ADR-016).
type ServiceUpdate struct {
	State   gen.UpdateServiceInput
	Touched map[string]bool
}

// UpdateOwnedService — nil when the id does not exist or belongs to
// someone else (caller answers 404 either way); NoServiceUpdatesError
// when the payload carries no writable field.

// UpdateOwnedServiceTx is UpdateOwnedService on a caller-supplied
// querier — paired with GetOwnedServiceTx on one merge-patch
// transaction (P2).
func UpdateOwnedServiceTx(ctx context.Context, q Querier, organizerID, serviceID string, update ServiceUpdate) (*ServiceRow, error) {
	// Defense in depth: routes already refuse the demo account via
	// RequireWritableOrganizer — a direct db call must not write it either.
	if err := demo.AssertNotDemo(organizerID); err != nil {
		return nil, err
	}
	sets := []string{}
	args := []any{}
	n := 1
	add := func(col string, val any) {
		sets = append(sets, fmt.Sprintf("%s = $%d", col, n))
		args = append(args, val)
		n++
	}
	setNull := func(col string) { sets = append(sets, col+" = NULL") }

	state := update.State
	if update.Touched["title"] && state.Title != nil {
		add("title", *state.Title)
	}
	if update.Touched["description"] {
		if state.Description != nil {
			add("description", *state.Description)
		} else {
			setNull("description")
		}
	}
	if update.Touched["location"] {
		if state.Location != nil {
			add("location", *state.Location)
		} else {
			setNull("location")
		}
	}
	if update.Touched["contact"] {
		if state.Contact != nil {
			add("contact", *state.Contact)
		} else {
			setNull("contact")
		}
	}
	if update.Touched["defaultPrice"] && state.DefaultPrice != nil {
		add("default_price", *state.DefaultPrice)
	}
	if update.Touched["defaultCapacity"] && state.DefaultCapacity != nil {
		add("default_capacity", *state.DefaultCapacity)
	}
	if update.Touched["defaultDurationMinutes"] && state.DefaultDurationMinutes != nil {
		add("default_duration_minutes", *state.DefaultDurationMinutes)
	}
	if update.Touched["maxSeatsPerBooking"] && state.MaxSeatsPerBooking != nil {
		add("max_seats_per_booking", *state.MaxSeatsPerBooking)
	}
	if update.Touched["options"] {
		if state.Options != nil {
			add("options", *state.Options)
		} else {
			setNull("options")
		}
	}
	if update.Touched["optionsSelectMode"] {
		if state.OptionsSelectMode != nil {
			sets = append(sets, fmt.Sprintf("options_select_mode = $%d::options_select_mode", n))
			args = append(args, string(*state.OptionsSelectMode))
			n++
		} else {
			setNull("options_select_mode")
		}
	}
	if update.Touched["photoUrl"] {
		if state.PhotoURL != nil {
			add("photo_url", *state.PhotoURL)
		} else {
			setNull("photo_url")
		}
	}
	if len(sets) == 0 {
		return nil, NoServiceUpdatesError{}
	}

	args = append(args, serviceID, organizerID)
	query := fmt.Sprintf(`UPDATE services SET %s WHERE id = $%d AND organizer_id = $%d::uuid RETURNING %s`,
		strings.Join(sets, ", "), n, n+1, serviceColumns)
	return scanService(q.QueryRow(ctx, query, args...))
}

// ServiceHasBookingsError — a booking row (confirmed or cancelled)
// references one of the service's slots, so the service cannot be
// deleted without losing guest records. The caller answers 409;
// cancelling a booking does not remove it, so there is no organizer
// action that clears the error for MVP.
type ServiceHasBookingsError struct{}

func (ServiceHasBookingsError) Error() string { return "Service has bookings" }

// DeleteOwnedService — refuses to delete a service whose slots are
// referenced by any booking row. Slots cascade on the services FK, but
// bookings hold their slots with ON DELETE RESTRICT, so the cascade
// stops at the first booked slot and the raw FK error would surface as
// a 500. The guard runs first and answers a 409 the organizer can act
// on; the FK mapping below is the backstop. Returns "" when nothing
// matched. The deleted cover URL rides along so the caller can remove
// the R2 object best-effort after the commit (same pattern as the PUT
// handlers) — a separate read-then-delete would race with a concurrent
// PUT pointing the row at a new cover.
func DeleteOwnedService(ctx context.Context, organizerID, serviceID string) (string, *string, error) {
	if err := demo.AssertNotDemo(organizerID); err != nil {
		return "", nil, err
	}
	tx, err := Pool().Begin(ctx)
	if err != nil {
		return "", nil, err
	}
	defer tx.Rollback(context.Background()) //nolint

	// Lock the service row so the check sees a stable parent: FOR UPDATE
	// serializes against a concurrent service delete, not against a
	// concurrent booking INSERT (bookings lock the slot row, not the
	// service row). A booking landing between the guard and the DELETE
	// is caught by the FK backstop below, which answers the same 409.
	var id string
	err = tx.QueryRow(ctx,
		`SELECT id FROM services WHERE id = $1 AND organizer_id = $2::uuid FOR UPDATE`,
		serviceID, organizerID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, nil
	}
	if err != nil {
		return "", nil, err
	}

	var referenced int
	err = tx.QueryRow(ctx, `
		SELECT count(*) FROM bookings b
		INNER JOIN time_slots ts ON b.time_slot_id = ts.id
		WHERE ts.service_id = $1`, serviceID).Scan(&referenced)
	if err != nil {
		return "", nil, err
	}
	if referenced > 0 {
		return "", nil, ServiceHasBookingsError{}
	}

	var photoURL *string
	err = tx.QueryRow(ctx,
		`DELETE FROM services WHERE id = $1 RETURNING photo_url`, serviceID).Scan(&photoURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, nil
	}
	if err != nil {
		// Backstop: a stray FK violation must surface as the same 409,
		// never a bare 500.
		if isForeignKeyViolation(err) {
			return "", nil, ServiceHasBookingsError{}
		}
		return "", nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", nil, err
	}
	return id, photoURL, nil
}
