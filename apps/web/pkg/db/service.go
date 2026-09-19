package db

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"countmein/pkg/contracts"

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

func ToServiceRecord(s ServiceRow) contracts.ServiceRecord {
	var mode *contracts.OptionsSelectMode
	if s.OptionsSelectMode != nil {
		m := contracts.OptionsSelectMode(*s.OptionsSelectMode)
		mode = &m
	}
	return contracts.ServiceRecord{
		ID:                     s.ID,
		OrganizerID:            s.OrganizerID,
		Title:                  s.Title,
		Description:            s.Description,
		PhotoURL:               s.PhotoURL,
		Location:               s.Location,
		Contact:                s.Contact,
		DefaultPrice:           s.DefaultPrice,
		DefaultCapacity:        s.DefaultCapacity,
		DefaultDurationMinutes: s.DefaultDurationMinutes,
		MaxSeatsPerBooking:     s.MaxSeatsPerBooking,
		Options:                s.Options,
		OptionsSelectMode:      mode,
		CreatedAt:              contracts.ISODate(s.CreatedAt),
	}
}

// ListServices — all services of an organizer, oldest first.
func ListServices(ctx context.Context, organizerID string) ([]ServiceRow, error) {
	rows, err := Pool().Query(ctx,
		`SELECT `+serviceColumns+` FROM services WHERE organizer_id = $1::uuid ORDER BY created_at ASC`,
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
	return scanService(Pool().QueryRow(ctx,
		`SELECT `+serviceColumns+` FROM services WHERE id = $1 AND organizer_id = $2::uuid LIMIT 1`,
		serviceID, organizerID))
}

// CreateService — the owner always comes from the session, never the
// payload; optional columns are normalized to null.
func CreateService(ctx context.Context, organizerID string, input contracts.CreateServiceInput) (*ServiceRow, error) {
	id := newServiceID()
	var modeStr *string
	if input.OptionsSelectMode != nil {
		s := string(*input.OptionsSelectMode)
		modeStr = &s
	}
	row := Pool().QueryRow(ctx, `
		INSERT INTO services (id, organizer_id, title, description, photo_url, location, contact,
			default_price, default_capacity, default_duration_minutes, max_seats_per_booking,
			options, options_select_mode)
		VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::options_select_mode)
		RETURNING `+serviceColumns,
		id, organizerID, input.Title, input.Description, input.PhotoURL, input.Location, input.Contact,
		input.DefaultPrice, input.DefaultCapacity, input.DefaultDurationMinutes, input.MaxSeatsPerBooking,
		nullableSlice(input.Options), modeStr)
	return scanService(row)
}

// NoServiceUpdatesError — the update payload contains no writable field.
type NoServiceUpdatesError struct{}

func (NoServiceUpdatesError) Error() string { return "No fields to update" }

// UpdateOwnedService — nil when the id does not exist or belongs to
// someone else (caller answers 404 either way); NoServiceUpdatesError
// when the payload carries no writable field.
func UpdateOwnedService(ctx context.Context, organizerID, serviceID string, input contracts.UpdateServiceInput) (*ServiceRow, error) {
	sets := []string{}
	args := []any{}
	n := 1
	add := func(col string, val any) {
		sets = append(sets, fmt.Sprintf("%s = $%d", col, n))
		args = append(args, val)
		n++
	}
	setNull := func(col string) { sets = append(sets, col+" = NULL") }

	if input.Title.Set && input.Title.Value != nil {
		add("title", *input.Title.Value)
	}
	if input.Description.Set {
		if input.Description.Value != nil {
			add("description", *input.Description.Value)
		} else {
			setNull("description")
		}
	}
	if input.Location.Set {
		if input.Location.Value != nil {
			add("location", *input.Location.Value)
		} else {
			setNull("location")
		}
	}
	if input.Contact.Set {
		if input.Contact.Value != nil {
			add("contact", *input.Contact.Value)
		} else {
			setNull("contact")
		}
	}
	if input.DefaultPrice.Set && input.DefaultPrice.Value != nil {
		add("default_price", *input.DefaultPrice.Value)
	}
	if input.DefaultCapacity.Set && input.DefaultCapacity.Value != nil {
		add("default_capacity", *input.DefaultCapacity.Value)
	}
	if input.DefaultDurationMinutes.Set && input.DefaultDurationMinutes.Value != nil {
		add("default_duration_minutes", *input.DefaultDurationMinutes.Value)
	}
	if input.MaxSeatsPerBooking.Set && input.MaxSeatsPerBooking.Value != nil {
		add("max_seats_per_booking", *input.MaxSeatsPerBooking.Value)
	}
	if input.Options.Set {
		if input.Options.Value != nil {
			add("options", *input.Options.Value)
		} else {
			setNull("options")
		}
	}
	if input.OptionsSelectMode.Set {
		if input.OptionsSelectMode.Value != nil {
			sets = append(sets, fmt.Sprintf("options_select_mode = $%d::options_select_mode", n))
			args = append(args, string(*input.OptionsSelectMode.Value))
			n++
		} else {
			setNull("options_select_mode")
		}
	}
	if input.PhotoURL.Set {
		if input.PhotoURL.Value != nil {
			add("photo_url", *input.PhotoURL.Value)
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
	return scanService(Pool().QueryRow(ctx, query, args...))
}

// DeleteOwnedService — slots and their bookings cascade (the services
// FK), so this also removes any scheduled sessions. Returns "" when
// nothing matched.
func DeleteOwnedService(ctx context.Context, organizerID, serviceID string) (string, error) {
	var id string
	err := Pool().QueryRow(ctx,
		`DELETE FROM services WHERE id = $1 AND organizer_id = $2::uuid RETURNING id`,
		serviceID, organizerID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return id, nil
}

// nullableSlice keeps nil distinct from empty for array params.
func nullableSlice(s []string) any {
	if s == nil {
		return nil
	}
	return s
}
