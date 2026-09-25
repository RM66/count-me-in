package db

import (
	"context"
	"errors"
	"testing"
	"time"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/contracts"
	"countmein/pkg/demo"
)

// Guard behavior that must not depend on Postgres: CanCancelBooking
// mirrors the guest DTO's canCancel, and the demo refusal must sit
// inside the db layer (defense in depth, ADR-010) before any query
// runs.

func TestCanCancelBooking(t *testing.T) {
	future := time.Now().Add(time.Hour)
	past := time.Now().Add(-time.Hour)
	cases := []struct {
		name   string
		row    BookingRow
		expect bool
	}{
		{"confirmed with live token", BookingRow{Status: "confirmed", ManageTokenExpiresAt: &future}, true},
		{"confirmed legacy row (NULL expiry)", BookingRow{Status: "confirmed", ManageTokenExpiresAt: nil}, true},
		{"confirmed expired token", BookingRow{Status: "confirmed", ManageTokenExpiresAt: &past}, false},
		{"cancelled with live token", BookingRow{Status: "cancelled", ManageTokenExpiresAt: &future}, false},
		{"cancelled legacy row", BookingRow{Status: "cancelled", ManageTokenExpiresAt: nil}, false},
	}
	for _, tc := range cases {
		if got := CanCancelBooking(tc.row); got != tc.expect {
			t.Errorf("%s: CanCancelBooking = %v, want %v", tc.name, got, tc.expect)
		}
	}
}

// A direct db call with the demo (or an absent) organizer id must be
// refused before touching Postgres — the route guard is the first line,
// this is the second (ADR-010).
func TestDBLayerRefusesDemoWrites(t *testing.T) {
	ctx := context.Background()
	for _, id := range []string{contracts.DemoOrganizerID, ""} {
		var refused demo.DemoReadOnlyError
		if _, err := DeleteOwnedSlot(ctx, id, newID()); !errors.As(err, &refused) {
			t.Errorf("DeleteOwnedSlot(%q) must be DemoReadOnlyError, got %T: %v", id, err, err)
		}
		if _, _, err := DeleteOwnedService(ctx, id, "svc"); !errors.As(err, &refused) {
			t.Errorf("DeleteOwnedService(%q) must be DemoReadOnlyError, got %T: %v", id, err, err)
		}
		if _, err := CreateSlot(ctx, id, gen.CreateTimeSlotInput{}); !errors.As(err, &refused) {
			t.Errorf("CreateSlot(%q) must be DemoReadOnlyError, got %T: %v", id, err, err)
		}
		if err := UpdateOrganizerLanguage(ctx, id, "en"); !errors.As(err, &refused) {
			t.Errorf("UpdateOrganizerLanguage(%q) must be DemoReadOnlyError, got %T: %v", id, err, err)
		}
	}
}

// A slot whose only booking was cancelled cannot be deleted: the guard
// counts every referencing row (the FK is ON DELETE RESTRICT), so the
// route answers 409 instead of a raw 23503 → 500. Once the rows are
// gone the delete succeeds — the guard does not over-block.
func TestDeleteOwnedSlotRefusesCancelledBookings(t *testing.T) {
	f := newFixture(t, nil)
	ctx := context.Background()
	expiresAt := time.Now().Add(time.Hour)
	bookingID, _ := f.insertBooking(t, 1, &expiresAt)
	if _, err := Pool().Exec(ctx,
		`UPDATE bookings SET status = 'cancelled' WHERE id = $1::uuid`, bookingID); err != nil {
		t.Fatal(err)
	}

	deleted, err := DeleteOwnedSlot(ctx, f.organizerID, f.slotID)
	var hasBookings SlotHasActiveBookingsError
	if !errors.As(err, &hasBookings) {
		t.Fatalf("cancelled booking must block the delete with SlotHasActiveBookingsError, got %T: %v", err, err)
	}
	if deleted != "" {
		t.Errorf("nothing may be deleted, got id %q", deleted)
	}
	var stillThere bool
	if err := Pool().QueryRow(ctx,
		`SELECT count(*) > 0 FROM time_slots WHERE id = $1::uuid`, f.slotID).Scan(&stillThere); err != nil {
		t.Fatal(err)
	}
	if !stillThere {
		t.Fatal("the slot must survive a refused delete")
	}

	if _, err := Pool().Exec(ctx, `DELETE FROM bookings WHERE id = $1::uuid`, bookingID); err != nil {
		t.Fatal(err)
	}
	deleted, err = DeleteOwnedSlot(ctx, f.organizerID, f.slotID)
	if err != nil {
		t.Fatalf("delete without referencing rows: %v", err)
	}
	if deleted != f.slotID {
		t.Errorf("deleted id = %q, want %q", deleted, f.slotID)
	}
}

// A service whose slots were ever booked cannot be deleted (the cascade
// would stop at the RESTRICT FK) — 409, never a 500.
func TestDeleteOwnedServiceRefusesBookings(t *testing.T) {
	f := newFixture(t, nil)
	ctx := context.Background()
	expiresAt := time.Now().Add(time.Hour)
	f.insertBooking(t, 1, &expiresAt)

	id, photoURL, err := DeleteOwnedService(ctx, f.organizerID, f.serviceID)
	var hasBookings ServiceHasBookingsError
	if !errors.As(err, &hasBookings) {
		t.Fatalf("booked service must be refused with ServiceHasBookingsError, got %T: %v", err, err)
	}
	if id != "" || photoURL != nil {
		t.Errorf("nothing may be returned, got id %q photo %v", id, photoURL)
	}
	var stillThere bool
	if err := Pool().QueryRow(ctx,
		`SELECT count(*) > 0 FROM services WHERE id = $1`, f.serviceID).Scan(&stillThere); err != nil {
		t.Fatal(err)
	}
	if !stillThere {
		t.Fatal("the service must survive a refused delete")
	}
}
