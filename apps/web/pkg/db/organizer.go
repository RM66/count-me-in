package db

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/contracts"

	"github.com/jackc/pgx/v5"
)

// Server-side reads, writes and DTO mapping for organizers. Two
// projections, one table: OrganizerProfile is the organizer's own view,
// PublicOrganizer the one guests get — keeping them as separate mappers
// stops the messenger identity from leaking to a public page.

type OrganizerRow struct {
	ID          string
	Slug        string
	Name        string
	Messenger   string
	MessengerID string
	Timezone    string
	Language    string
	Description *string
	PhotoURL    *string
	Location    *string
	Contact     *string
	CreatedAt   time.Time
}

const organizerColumns = `id, slug, name, messenger::text, messenger_id, timezone, language, description, photo_url, location, contact, created_at`

func scanOrganizer(row pgx.Row) (*OrganizerRow, error) {
	var o OrganizerRow
	err := row.Scan(&o.ID, &o.Slug, &o.Name, &o.Messenger, &o.MessengerID, &o.Timezone, &o.Language,
		&o.Description, &o.PhotoURL, &o.Location, &o.Contact, &o.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// ToOrganizerProfile — dates → ISO strings; language clamped to the
// supported set (a stale column value must not break rendering).
func ToOrganizerProfile(o OrganizerRow, isDemo bool) gen.OrganizerProfile {
	language := gen.AppLocale(o.Language)
	if !contracts.IsAppLocale(o.Language) {
		language = gen.AppLocale(contracts.DefaultLocale)
	}
	return gen.OrganizerProfile{
		ID:          contracts.ToUUID(o.ID),
		Slug:        o.Slug,
		Name:        o.Name,
		Messenger:   gen.Messenger(o.Messenger),
		MessengerID: o.MessengerID,
		Timezone:    o.Timezone,
		Description: o.Description,
		PhotoURL:    o.PhotoURL,
		Location:    o.Location,
		Contact:     o.Contact,
		Language:    language,
		CreatedAt:   contracts.ISODate(o.CreatedAt),
		IsDemo:      isDemo,
	}
}

// ToPublicOrganizer — the public projection; isDemo derived from the id.
func ToPublicOrganizer(o OrganizerRow) gen.PublicOrganizer {
	return gen.PublicOrganizer{
		ID:          contracts.ToUUID(o.ID),
		Slug:        o.Slug,
		Name:        o.Name,
		Timezone:    o.Timezone,
		Description: o.Description,
		PhotoURL:    o.PhotoURL,
		Location:    o.Location,
		Contact:     o.Contact,
		IsDemo:      contracts.IsDemoOrganizerID(o.ID),
	}
}

// GetOrganizerProfile — the profile for the organizer this request may
// view; nil when the id does not exist (e.g. demo not yet seeded).
func GetOrganizerProfile(ctx context.Context, organizerID string) (*OrganizerRow, error) {
	row := Pool().QueryRow(ctx,
		`SELECT `+organizerColumns+` FROM organizers WHERE id = $1::uuid`, organizerID)
	return scanOrganizer(row)
}

// ExistsOrganizerByMessenger — used by the signup flow to decide
// sign-in vs registration.
func ExistsOrganizerByMessenger(ctx context.Context, messenger, messengerID string) (bool, error) {
	var one int
	err := Pool().QueryRow(ctx,
		`SELECT 1 FROM organizers WHERE messenger = $1::messenger_kind AND messenger_id = $2`,
		messenger, messengerID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// NoOrganizerUpdatesError — the update payload contains no writable field.
type NoOrganizerUpdatesError struct{}

func (NoOrganizerUpdatesError) Error() string { return "No fields to update" }

// OrganizerUpdate carries the merged state and the set of keys the patch
// touched (RFC 7386 merge-patch, ADR-016).
type OrganizerUpdate struct {
	State   gen.UpdateOrganizerProfileInput
	Touched map[string]bool
}

// InsertOrganizer registers an organizer; the messenger identity comes
// from the peeked ticket (validated server-side), never from the body.
// A 23505 surfaces as the raw *pgconn.PgError for the route to map to
// slugTaken / accountExists by constraint name.
func InsertOrganizer(ctx context.Context, input gen.RegisterOrganizerInput, identity contracts.AuthTicketPayload) (gen.RegisteredOrganizer, error) {
	id := newID()
	var out gen.RegisteredOrganizer
	err := Pool().QueryRow(ctx, `
		INSERT INTO organizers (id, slug, name, messenger, messenger_id, timezone, language, contact, photo_url)
		VALUES ($1::uuid, $2, $3, $4::messenger_kind, $5, $6, $7, $8, $9)
		RETURNING id, slug`,
		id, input.Slug, input.Name, identity.Messenger, identity.MessengerID,
		input.Timezone, string(*input.Language), input.Contact, identity.PhotoURL,
	).Scan(&out.ID, &out.Slug)
	if err != nil {
		return out, err
	}
	return out, nil
}

// UpdateOrganizerProfile — editable fields only; messenger identity,
// id and createdAt are set at registration and never editable.
// Absent keys are left untouched, explicit nulls clear the column
// (merge-patch semantics, ADR-016).
func UpdateOrganizerProfile(ctx context.Context, organizerID string, update OrganizerUpdate) (*OrganizerRow, error) {
	sets := []string{}
	args := []any{}
	n := 1
	add := func(col string, val any) {
		sets = append(sets, fmt.Sprintf("%s = $%d", col, n))
		args = append(args, val)
		n++
	}
	setNull := func(col string) {
		sets = append(sets, col+" = NULL")
	}

	state := update.State
	if update.Touched["name"] && state.Name != nil {
		add("name", *state.Name)
	}
	if update.Touched["slug"] && state.Slug != nil {
		add("slug", *state.Slug)
	}
	if update.Touched["timezone"] && state.Timezone != nil {
		add("timezone", *state.Timezone)
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
	if update.Touched["photoUrl"] {
		if state.PhotoURL != nil {
			add("photo_url", *state.PhotoURL)
		} else {
			setNull("photo_url")
		}
	}
	if len(sets) == 0 {
		return nil, NoOrganizerUpdatesError{}
	}

	args = append(args, organizerID)
	query := fmt.Sprintf(`UPDATE organizers SET %s WHERE id = $%d::uuid RETURNING %s`,
		strings.Join(sets, ", "), n, organizerColumns)
	return scanOrganizer(Pool().QueryRow(ctx, query, args...))
}

// UpdateOrganizerLanguage — set the organizer's notification language
// (ADR-011). Called by the language switcher via the Go API. Silent
// no-op for an unknown id (0 rows affected, no error) — mirrors the
// original Drizzle behaviour for a stale session.
func UpdateOrganizerLanguage(ctx context.Context, organizerID, language string) error {
	_, err := Pool().Exec(ctx,
		`UPDATE organizers SET language = $1 WHERE id = $2::uuid`,
		language, organizerID)
	return err
}
