package db

import (
	"context"

	gen "countmein/pkg/api/gen"
)

// Booking reads (guest-facing; the cabinet reads live in the Next.js
// server layer — this package owns the write side, ADR-013).

// ListGuestBookings — every booking of one messenger identity, newest
// first (ADR-002, entry path 2). Cancelled bookings are included: a
// guest looking for "my bookings" is often checking whether a
// cancellation went through. Expired manageTokens stay listed too (
// the DTO marks them canCancel=false): dropping the row would silently
// erase the guest's booking history 24h after the slot, and the caller
// of this endpoint *is* the owner of the identity, so the expired
// token is not a leak.
func ListGuestBookings(ctx context.Context, messenger, messengerID string) ([]gen.GuestBooking, error) {
	rows, err := Pool().Query(ctx, bookingChainSelect+`
		WHERE b.guest_messenger = $1::messenger_kind AND b.guest_messenger_id = $2
		ORDER BY b.created_at DESC
		LIMIT 200`, messenger, messengerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []gen.GuestBooking{}
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
