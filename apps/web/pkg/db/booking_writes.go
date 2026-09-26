package db

import (
	"context"
	"errors"
	"time"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/contracts"
	"countmein/pkg/demo"

	"github.com/jackc/pgx/v5"
)

// Booking writes. Seats move only through the atomic reserve below; the
// demo guard runs inside the transaction because these routes carry no
// session — the organizer is only known once the slot joins its service.

// CreateBookingData carries the validated booking input plus the
// resolved guest identity into the booking transaction (hand-written
// request plumbing, not a wire type).
type CreateBookingData struct {
	ServiceID       string
	TimeSlotID      string
	Seats           int
	GuestName       string
	SelectedOptions []string
	GuestLocale     string
	Guest           contracts.AuthTicketPayload
	TraceID         string
}

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
// The second return value is the outbox rows written in the same
// transaction: the caller publishes them inline after commit and
// marks each `sent` on success, so the sweeper never re-publishes a
// delivered row.
func CreateGuestBooking(ctx context.Context, data CreateBookingData) (*gen.GuestBooking, []OutboxRow, error) {
	tx, err := Pool().Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(context.Background()) //nolint

	// A slot in the past is not bookable:
	// the UI filters them out, but the API must not rely on that —
	// knowing the id must not let anyone book a session that already
	// started (its manageToken would be born expired). The predicate
	// lives in the chain-select, so a past slot is answered exactly
	// like a missing one: SlotNotBookableError → 404 slotGone.
	slot, service, organizer, err := scanSlotChain(tx.QueryRow(ctx,
		slotChainSelect+` WHERE ts.id = $1::uuid AND s.id = $2 AND ts.starts_at > now() LIMIT 1`, data.TimeSlotID, data.ServiceID))
	if err != nil {
		return nil, nil, err
	}
	if slot == nil {
		return nil, nil, SlotNotBookableError{}
	}

	if err := demo.AssertNotDemo(organizer.ID); err != nil {
		return nil, nil, err
	}

	mode := gen.Multi
	if service.OptionsSelectMode != nil && *service.OptionsSelectMode == string(gen.Single) {
		mode = gen.Single
	}
	selected, err := contracts.ValidateSelectedOptions(service.Options, mode, data.SelectedOptions)
	if err != nil {
		return nil, nil, InvalidOptionSelectionError{Msg: err.Error()}
	}

	// Organizer's per-booking cap — enforced before the atomic reserve
	// so an oversized party is refused outright rather than competing
	// for seats.
	if data.Seats > service.MaxSeatsPerBooking {
		return nil, nil, PartyTooLargeError{MaxSeats: service.MaxSeatsPerBooking}
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
		return nil, nil, SlotSoldOutError{SeatsLeft: contracts.SeatsLeft(slot.Capacity, slot.BookedCount)}
	}
	if err != nil {
		return nil, nil, err
	}

	// manageToken expiry (fix #4): the token is usable until the slot
	// starts plus a grace period — a past event's booking does not need
	// cancel access.
	expiresAt := claimed.StartsAt.Add(manageTokenGracePeriod)
	token := newManageToken()
	created, err := scanBooking(tx.QueryRow(ctx, `
		INSERT INTO bookings (id, time_slot_id, status, seats, guest_name, guest_messenger, guest_messenger_id,
			guest_messenger_login, guest_locale, manage_token, manage_token_hash, selected_options, manage_token_expires_at)
		VALUES ($1::uuid, $2::uuid, $3::booking_status, $4, $5, $6::messenger_kind, $7, $8, $9, $10, $11, $12, $13)
		RETURNING `+bookingColumns,
		newID(), claimed.ID, "confirmed", data.Seats, data.GuestName,
		string(data.Guest.Messenger), data.Guest.MessengerID, data.Guest.MessengerLogin,
		data.GuestLocale, token, HashManageToken(token), nullableSlice(selected), expiresAt))
	if err != nil {
		// Duplicate booking — the transaction rolls back, releasing the
		// claimed seat (partial unique index, invariant 4).
		if UniqueViolation(err) != nil {
			return nil, nil, DuplicateBookingError{}
		}
		return nil, nil, err
	}
	if created == nil {
		return nil, nil, SlotNotBookableError{}
	}

	// Transactional outbox: write one
	// outbox row per recipient in the same transaction, so a crash
	// between commit and the inline publish does not lose the
	// notification — the sweeper re-publishes pending rows. The rows
	// travel back to the caller, which owns the inline delivery and the
	// `sent` marking.
	outbox := make([]OutboxRow, 0, 2)
	for _, recipient := range []gen.NotificationRecipient{gen.NotificationRecipientOrganizer, gen.NotificationRecipientGuest} {
		row, err := EnqueueOutbox(ctx, tx, contracts.QueueBookingCreated, func(outboxID string) any {
			return gen.BookingCreatedJob{
				BookingID: contracts.ToUUID(created.ID), Recipient: recipient, OutboxID: contracts.ToUUID(outboxID),
			}
		}, data.TraceID)
		if err != nil {
			return nil, nil, err
		}
		outbox = append(outbox, row)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	guest := ToGuestBooking(*created, claimed, *service, *organizer)
	return &guest, outbox, nil
}

// CancelGuestBookingByToken cancels by manageToken and releases the
// seats (ADR-002). Status flip and bookedCount decrement happen in one
// transaction — invariant 1: the counter equals the seats held by
// confirmed bookings. The status='confirmed' predicate makes this
// idempotent under a double-tap: the second call updates no row and is
// reported as already cancelled instead of decrementing twice.
// Returns nil for an unknown token (caller answers 404 without
// confirming whether the token exists).
func CancelGuestBookingByToken(ctx context.Context, token, traceID string) (*gen.GuestBooking, []OutboxRow, error) {
	tx, err := Pool().Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(context.Background()) //nolint

	// Credential check goes through the hash:
	// the raw token column is not a lookup key anymore.
	b, slot, service, organizer, err := scanBookingChain(tx.QueryRow(ctx,
		bookingChainSelect+` WHERE b.manage_token_hash = $1 LIMIT 1`, HashManageToken(token)))
	if err != nil {
		return nil, nil, err
	}
	if b == nil {
		return nil, nil, nil
	}

	if err := demo.AssertNotDemo(organizer.ID); err != nil {
		return nil, nil, err
	}

	// manageToken expiry: a token past its
	// expiry is answered like an unknown one (nil → 404) so the endpoint
	// cannot be used to test whether a token exists. nil = non-expiring
	// (legacy rows created before the column was added).
	if b.ManageTokenExpiresAt != nil && time.Now().After(*b.ManageTokenExpiresAt) {
		return nil, nil, ManageTokenExpiredError{}
	}

	cancelled, err := scanBooking(tx.QueryRow(ctx, `
		UPDATE bookings SET status = 'cancelled'
		WHERE id = $1::uuid AND status = 'confirmed'
		RETURNING `+bookingColumns, b.ID))
	if err != nil {
		return nil, nil, err
	}
	if cancelled == nil {
		return nil, nil, BookingAlreadyCancelledError{}
	}

	released, err := scanSlot(tx.QueryRow(ctx, `
		UPDATE time_slots SET booked_count = greatest(0, booked_count - $1)
		WHERE id = $2::uuid
		RETURNING `+slotColumns, cancelled.Seats, cancelled.TimeSlotID))
	if err != nil {
		return nil, nil, err
	}
	if released == nil {
		released = slot // released can't vanish while the booking points at it
	}

	// Transactional outbox: the organizer
	// is notified of the guest's cancellation. One row — the counterparty
	// only (ADR-012). The row travels back to the caller for the inline
	// publish + `sent` marking.
	outboxRow, err := EnqueueOutbox(ctx, tx, contracts.QueueBookingCancelled, func(outboxID string) any {
		return gen.BookingCancelledJob{
			BookingID: contracts.ToUUID(cancelled.ID), CancelledBy: gen.CancelActorGuest, OutboxID: contracts.ToUUID(outboxID),
		}
	}, traceID)
	if err != nil {
		return nil, nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	guest := ToGuestBooking(*cancelled, *released, *service, *organizer)
	return &guest, []OutboxRow{outboxRow}, nil
}

// CancelOwnedBooking — the cabinet counterpart of CancelGuestBookingByToken:
// same state transition and seat release, reached by a different
// credential. The organizer proves ownership by owning the service the
// booking hangs off, so the id is scoped through ownedServiceIds.
// Returns the organizer's DTO, which drops manageToken: the cabinet
// must never receive it, even as a side effect.
func CancelOwnedBooking(ctx context.Context, organizerID, bookingID, traceID string) (*gen.BookingRecord, []OutboxRow, error) {
	if err := demo.AssertNotDemo(organizerID); err != nil {
		return nil, nil, err
	}

	tx, err := Pool().Begin(ctx)
	if err != nil {
		return nil, nil, err
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
		return nil, nil, err
	}
	if target == nil {
		return nil, nil, nil
	}

	cancelled, err := scanBooking(tx.QueryRow(ctx, `
		UPDATE bookings SET status = 'cancelled'
		WHERE id = $1::uuid AND status = 'confirmed'
		RETURNING `+bookingColumns, target.ID))
	if err != nil {
		return nil, nil, err
	}
	if cancelled == nil {
		return nil, nil, BookingAlreadyCancelledError{}
	}

	if _, err := tx.Exec(ctx, `
		UPDATE time_slots SET booked_count = greatest(0, booked_count - $1)
		WHERE id = $2::uuid`, cancelled.Seats, cancelled.TimeSlotID); err != nil {
		return nil, nil, err
	}

	// Transactional outbox: the guest is
	// notified of the organizer's cancellation. One row — the
	// counterparty only (ADR-012). The row travels back to the caller
	// for the inline publish + `sent` marking.
	outboxRow, err := EnqueueOutbox(ctx, tx, contracts.QueueBookingCancelled, func(outboxID string) any {
		return gen.BookingCancelledJob{
			BookingID: contracts.ToUUID(cancelled.ID), CancelledBy: gen.CancelActorOrganizer, OutboxID: contracts.ToUUID(outboxID),
		}
	}, traceID)
	if err != nil {
		return nil, nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	record := ToBookingRecord(*cancelled)
	return &record, []OutboxRow{outboxRow}, nil
}
