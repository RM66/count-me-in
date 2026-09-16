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
func ToOrganizerProfile(o OrganizerRow, isDemo bool) contracts.OrganizerProfile {
	language := o.Language
	if !contracts.IsAppLocale(language) {
		language = contracts.DefaultLocale
	}
	return contracts.OrganizerProfile{
		ID:          o.ID,
		Slug:        o.Slug,
		Name:        o.Name,
		Messenger:   o.Messenger,
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
func ToPublicOrganizer(o OrganizerRow) contracts.PublicOrganizer {
	return contracts.PublicOrganizer{
		ID:          o.ID,
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
// Typed (not a sentinel var) so the route can type-switch it into a 400,
// matching the sibling NoServiceUpdatesError / NoSlotUpdatesError pattern.
type NoOrganizerUpdatesError struct{}

func (NoOrganizerUpdatesError) Error() string { return "No fields to update" }

// InsertOrganizer registers an organizer; the messenger identity comes
// from the peeked ticket (validated server-side), never from the body.
// A 23505 surfaces as the raw *pgconn.PgError for the route to map to
// slugTaken / accountExists by constraint name.
func InsertOrganizer(ctx context.Context, input contracts.RegisterOrganizerInput, identity contracts.AuthTicketPayload) (contracts.RegisteredOrganizer, error) {
	id := newID()
	var out contracts.RegisteredOrganizer
	err := Pool().QueryRow(ctx, `
		INSERT INTO organizers (id, slug, name, messenger, messenger_id, timezone, language, contact, photo_url)
		VALUES ($1::uuid, $2, $3, $4::messenger_kind, $5, $6, $7, $8, $9)
		RETURNING id, slug`,
		id, input.Slug, input.Name, identity.Messenger, identity.MessengerID,
		input.Timezone, input.Language, input.Contact, identity.PhotoURL,
	).Scan(&out.ID, &out.Slug)
	if err != nil {
		return out, err
	}
	return out, nil
}

// UpdateOrganizerProfile — editable fields only; messenger identity,
// id and createdAt are set at registration and never editable.
// Absent keys are left untouched, explicit nulls clear the column
// (pickDefined semantics).
func UpdateOrganizerProfile(ctx context.Context, organizerID string, input contracts.UpdateOrganizerProfileInput) (*OrganizerRow, error) {
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

	if input.Name.Set && input.Name.Value != nil {
		add("name", *input.Name.Value)
	}
	if input.Slug.Set && input.Slug.Value != nil {
		add("slug", *input.Slug.Value)
	}
	if input.Timezone.Set && input.Timezone.Value != nil {
		add("timezone", *input.Timezone.Value)
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
	if input.PhotoURL.Set {
		if input.PhotoURL.Value != nil {
			add("photo_url", *input.PhotoURL.Value)
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
