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

// Server-side reads, writes and DTO mapping for time slots. Ownership
// is transitive: a slot belongs to a service, the service to an
// organizer (invariant 5), so every statement scopes through the parent
// service with an ownedServiceIds subquery in the WHERE clause —
// parameter positions are per-query (the subquery's organizer_id binds
// to its own placeholder, never reused from the outer scope).

type TimeSlotRow struct {
	ID              string
	ServiceID       string
	StartsAt        time.Time
	DurationMinutes int
	Capacity        int
	BookedCount     int
	Price           *string
	CreatedAt       time.Time
}

const slotColumns = `id, service_id, starts_at, duration_minutes, capacity, booked_count, price, created_at`

// ownedServiceIDsAt returns the services-an-organizer-owns subquery
// with organizer_id bound to the given 1-based parameter position.
func ownedServiceIDsAt(pos int) string {
	return fmt.Sprintf(`SELECT id FROM services WHERE organizer_id = $%d::uuid`, pos)
}

func scanSlot(row pgx.Row) (*TimeSlotRow, error) {
	var s TimeSlotRow
	err := row.Scan(&s.ID, &s.ServiceID, &s.StartsAt, &s.DurationMinutes, &s.Capacity, &s.BookedCount, &s.Price, &s.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func ToTimeSlotRecord(s TimeSlotRow) gen.TimeSlotRecord {
	return gen.TimeSlotRecord{
		ID:              contracts.ToUUID(s.ID),
		ServiceID:       s.ServiceID,
		StartsAt:        contracts.ISODate(s.StartsAt),
		DurationMinutes: s.DurationMinutes,
		Capacity:        s.Capacity,
		BookedCount:     s.BookedCount,
		Price:           s.Price,
		CreatedAt:       contracts.ISODate(s.CreatedAt),
	}
}

// ListSlots — every slot across an organizer's services, earliest
// first. upcomingOnly drops slots that have already started (the
// cabinet list is a schedule, past sessions are noise there).
func ListSlots(ctx context.Context, organizerID string, upcomingOnly bool) ([]TimeSlotRow, error) {
	query := `SELECT ts.` + strings.ReplaceAll(slotColumns, ", ", ", ts.") + `
		FROM time_slots ts
		WHERE ts.service_id IN (` + ownedServiceIDsAt(1) + `)`
	if upcomingOnly {
		query += ` AND ts.starts_at >= now()`
	}
	query += ` ORDER BY ts.starts_at ASC`

	rows, err := Pool().Query(ctx, query, organizerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TimeSlotRow{}
	for rows.Next() {
		s, err := scanSlot(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

// GetOwnedSlot — nil when the id does not exist *or* hangs off another
// organizer's service, so callers cannot leak a foreign slot by
// guessing ids.
func GetOwnedSlot(ctx context.Context, organizerID, slotID string) (*TimeSlotRow, error) {
	query := fmt.Sprintf(`SELECT %s FROM time_slots
		WHERE id = $1::uuid AND service_id IN (%s) LIMIT 1`,
		slotColumns, ownedServiceIDsAt(2))
	return scanSlot(Pool().QueryRow(ctx, query, slotID, organizerID))
}

// NoSlotUpdatesError — the update payload contains no writable field.
type NoSlotUpdatesError struct{}

func (NoSlotUpdatesError) Error() string { return "No fields to update" }

// SlotCapacityBelowBookedError — shrinking capacity below the seats
// already taken. A CHECK constraint would also catch this but as an
// opaque 23514; failing here turns it into a 409 that says how many
// seats are already booked.
type SlotCapacityBelowBookedError struct {
	BookedCount int
}

func (e SlotCapacityBelowBookedError) Error() string {
	return fmt.Sprintf("Capacity cannot be lower than the %d seats already booked", e.BookedCount)
}

// SlotHasActiveBookingsError — the slot has confirmed bookings, so it
// cannot be deleted without losing guest records. The caller answers
// 409; the organizer must cancel the bookings first.
type SlotHasActiveBookingsError struct{}

func (SlotHasActiveBookingsError) Error() string { return "Slot has active bookings" }

// SlotUpdate carries the merged state and the set of keys the patch
// touched (RFC 7386 merge-patch, ADR-016).
type SlotUpdate struct {
	State   gen.UpdateTimeSlotInput
	Touched map[string]bool
}

// slotStartsAtTime extracts the instant behind the generated oneOf
// wrapper (ISO string or epoch).
func slotStartsAtTime(s gen.SlotStartsAt) (time.Time, error) {
	raw, err := s.MarshalJSON()
	if err != nil {
		return time.Time{}, err
	}
	ft, err := contracts.FlexTimeFromRaw(raw)
	if err != nil {
		return time.Time{}, err
	}
	return ft.Time(), nil
}

// CreateSlot — under a service owned by organizerID; nil when the
// parent service does not exist or belongs to someone else (the
// caller answers 404 without ever confirming a foreign id).
// Ownership is confirmed by a SELECT before the insert (mirrors TS:
// the id is generated app-side, an INSERT…SELECT would skip it; the
// gap that opens is harmless — if the service disappears in between,
// the FK rejects the row).
func CreateSlot(ctx context.Context, organizerID string, input gen.CreateTimeSlotInput) (*TimeSlotRow, error) {
	var owned string
	err := Pool().QueryRow(ctx,
		`SELECT id FROM services WHERE id = $1 AND organizer_id = $2::uuid LIMIT 1`,
		input.ServiceID, organizerID).Scan(&owned)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	startsAt, err := slotStartsAtTime(input.StartsAt)
	if err != nil {
		return nil, err
	}

	id := newID()
	query := `INSERT INTO time_slots (id, service_id, starts_at, duration_minutes, capacity, price)
		VALUES ($1::uuid, $2, $3, $4, $5, $6) RETURNING ` + slotColumns
	return scanSlot(Pool().QueryRow(ctx, query, id, owned, startsAt, input.DurationMinutes, input.Capacity, input.Price))
}

// UpdateOwnedSlot — bookedCount is deliberately not updatable: seats
// move only through the atomic reserve in the booking flow (invariant
// 2). Shrinking capacity below the seats already sold answers a 409.
func UpdateOwnedSlot(ctx context.Context, organizerID, slotID string, update SlotUpdate) (*TimeSlotRow, error) {
	sets := []string{}
	args := []any{}
	n := 1
	add := func(col string, val any) {
		sets = append(sets, fmt.Sprintf("%s = $%d", col, n))
		args = append(args, val)
		n++
	}
	state := update.State
	if update.Touched["startsAt"] && state.StartsAt != nil {
		startsAt, err := slotStartsAtTime(*state.StartsAt)
		if err != nil {
			return nil, err
		}
		add("starts_at", startsAt)
	}
	if update.Touched["durationMinutes"] && state.DurationMinutes != nil {
		add("duration_minutes", *state.DurationMinutes)
	}
	if update.Touched["capacity"] && state.Capacity != nil {
		add("capacity", *state.Capacity)
	}
	if update.Touched["price"] {
		if state.Price != nil {
			add("price", *state.Price)
		} else {
			sets = append(sets, "price = NULL")
		}
	}
	if len(sets) == 0 {
		return nil, NoSlotUpdatesError{}
	}

	// WHERE scope: slot id + owned-services subquery, after the SET args.
	slotPos, orgPos := n, n+1
	args = append(args, slotID, organizerID)
	scope := fmt.Sprintf(`id = $%d::uuid AND service_id IN (%s)`, slotPos, ownedServiceIDsAt(orgPos))

	tx, err := Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(context.Background()) //nolint

	// Capacity precheck inside the same tx, under a row lock: a plain
	// SELECT takes no lock under READ COMMITTED, so the check could
	// race the booking flow's atomic reserve. FOR UPDATE serializes
	// against it — an improvement on the TS version, whose backstop is
	// the booked_count CHECK constraint surfacing as an opaque 23514.
	if update.Touched["capacity"] && state.Capacity != nil {
		var bookedCount int
		err := tx.QueryRow(ctx,
			`SELECT booked_count FROM time_slots WHERE `+scope+` FOR UPDATE`, args...).Scan(&bookedCount)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		if *state.Capacity < bookedCount {
			return nil, SlotCapacityBelowBookedError{BookedCount: bookedCount}
		}
	}

	query := fmt.Sprintf(`UPDATE time_slots SET %s WHERE %s RETURNING %s`,
		strings.Join(sets, ", "), scope, slotColumns)
	slot, err := scanSlot(tx.QueryRow(ctx, query, args...))
	if err != nil {
		return nil, err
	}
	if slot == nil {
		return nil, nil
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return slot, nil
}

// DeleteOwnedSlot — refuses to delete a slot that still has confirmed
// bookings (the time_slots FK is RESTRICT, so the database would reject
// the delete anyway; failing here turns the opaque FK error into a 409
// the organizer can act on). Returns "" when nothing matched.
func DeleteOwnedSlot(ctx context.Context, organizerID, slotID string) (string, error) {
	tx, err := Pool().Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(context.Background()) //nolint

	// Lock the slot row so the check and delete are atomic against the
	// booking flow's reserve. A plain SELECT takes no lock under READ
	// COMMITTED, so a booking could land between the check and the
	// delete; FOR UPDATE serializes against it.
	scope := fmt.Sprintf(`id = $1::uuid AND service_id IN (%s)`, ownedServiceIDsAt(2))
	var id string
	err = tx.QueryRow(ctx, `SELECT id FROM time_slots WHERE `+scope+` FOR UPDATE`, slotID, organizerID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}

	var active int
	err = tx.QueryRow(ctx,
		`SELECT count(*) FROM bookings WHERE time_slot_id = $1 AND status = 'confirmed'`, slotID).Scan(&active)
	if err != nil {
		return "", err
	}
	if active > 0 {
		return "", SlotHasActiveBookingsError{}
	}

	err = tx.QueryRow(ctx, `DELETE FROM time_slots WHERE id = $1 RETURNING id`, slotID).Scan(&id)
	if err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return id, nil
}
