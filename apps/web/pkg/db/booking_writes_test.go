package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/contracts"
	"countmein/pkg/demo"

	"github.com/google/uuid"
)

// the booking write invariants, against a real Postgres — the
// atomic seat reserve, the idempotent cancel, the manageToken hash
// lookup, the demo refusal inside the transaction, and the transactional
// outbox rows. Mocks cannot test the conditional UPDATE (invariant 2):
// the whole point is that Postgres evaluates the predicate against the
// row it locks.
//
// Runs against the local docker Postgres when POSTGRES_URL is set and
// migrated (docker-compose.yml + drizzle migrations); skipped locally
// without it, failed in CI (the workflow provides the service).

func requirePostgres(t *testing.T) {
	t.Helper()
	if os.Getenv("POSTGRES_URL") == "" {
		// A silent skip in CI would leave the booking invariants
		// unverified while the pipeline stays green — fail loudly
		// instead (the CI jobs provide an ephemeral Postgres).
		if os.Getenv("CI") == "true" {
			t.Fatal("POSTGRES_URL is not set in CI — Postgres service misconfigured, refusing silent skip")
		}
		t.Skip("POSTGRES_URL is not set — integration test needs the docker Postgres (set -a; source ../../.env, see docker-compose.yml)")
	}
}

// fixture: one organizer + one service + one future slot, unique per
// test run (uuid suffixes) so parallel runs never collide. Everything
// cascades from the organizer row on cleanup once the bookings are gone.
type fixture struct {
	organizerID string
	serviceID   string
	slotID      string
	bookingIDs  []string
}

func newFixture(t *testing.T, mutate func(slot *slotSpec)) *fixture {
	t.Helper()
	requirePostgres(t)
	ctx := context.Background()
	orgID, err := uuid.NewV7()
	if err != nil {
		t.Fatal(err)
	}
	f := &fixture{
		organizerID: orgID.String(),
		serviceID:   newServiceID(),
		slotID:      newID(),
	}
	suffix := f.organizerID[len(f.organizerID)-12:]

	_, err = Pool().Exec(ctx, `
		INSERT INTO organizers (id, slug, name, messenger, messenger_id, timezone, language)
		VALUES ($1::uuid, $2, $3, 'telegram', $4, 'Europe/Belgrade', 'en')`,
		f.organizerID, "it-org-"+suffix, "IT Organizer", "it-"+suffix)
	if err != nil {
		t.Fatalf("insert organizer: %v", err)
	}

	spec := slotSpec{startsAt: time.Now().Add(48 * time.Hour), capacity: 10, booked: 0, maxSeats: 4, options: nil, selectMode: ""}
	if mutate != nil {
		mutate(&spec)
	}

	optionsArg := nullableSlice(spec.options)
	selectModeArg := any(spec.selectMode)
	if spec.selectMode == "" {
		selectModeArg = nil // empty string is not a valid enum value — NULL means "no options"
	}
	_, err = Pool().Exec(ctx, `
		INSERT INTO services (id, organizer_id, title, default_price, default_capacity,
			default_duration_minutes, max_seats_per_booking, options, options_select_mode)
		VALUES ($1, $2::uuid, 'IT Service', '10 EUR', 10, 60, $3, $4, $5::options_select_mode)`,
		f.serviceID, f.organizerID, spec.maxSeats, optionsArg, selectModeArg)
	if err != nil {
		t.Fatalf("insert service: %v", err)
	}

	_, err = Pool().Exec(ctx, `
		INSERT INTO time_slots (id, service_id, starts_at, duration_minutes, capacity, booked_count)
		VALUES ($1::uuid, $2, $3, 60, $4, $5)`,
		f.slotID, f.serviceID, spec.startsAt, spec.capacity, spec.booked)
	if err != nil {
		t.Fatalf("insert slot: %v", err)
	}

	t.Cleanup(func() { f.cleanup(t) })
	return f
}

type slotSpec struct {
	startsAt   time.Time
	capacity   int
	booked     int
	maxSeats   int
	options    []string
	selectMode string
}

func (f *fixture) cleanup(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	// Outbox rows carry no FK — remove by the booking ids they reference.
	if len(f.bookingIDs) > 0 {
		_, _ = Pool().Exec(ctx, `DELETE FROM notification_outbox WHERE (payload::jsonb->>'bookingId')::text = ANY($1)`, f.bookingIDs)
		_, _ = Pool().Exec(ctx, `DELETE FROM bookings WHERE id::text = ANY($1)`, f.bookingIDs)
	}
	_, _ = Pool().Exec(ctx, `DELETE FROM organizers WHERE id = $1::uuid`, f.organizerID) // cascades services + slots
}

func (f *fixture) track(id string) string {
	f.bookingIDs = append(f.bookingIDs, id)
	return id
}

func (f *fixture) bookedCount(t *testing.T) int {
	t.Helper()
	var booked int
	if err := Pool().QueryRow(context.Background(),
		`SELECT booked_count FROM time_slots WHERE id = $1::uuid`, f.slotID).Scan(&booked); err != nil {
		t.Fatal(err)
	}
	return booked
}

func (f *fixture) insertBooking(t *testing.T, seats int, expiresAt *time.Time) (bookingID, token string) {
	t.Helper()
	ctx := context.Background()
	id := f.track(newID())
	token = newManageToken()
	_, err := Pool().Exec(ctx, `
		INSERT INTO bookings (id, time_slot_id, status, seats, guest_name, guest_messenger,
			guest_messenger_id, guest_locale, manage_token, manage_token_hash, manage_token_expires_at)
		VALUES ($1::uuid, $2::uuid, 'confirmed', $3, 'Ann', 'telegram', $4, 'en', $5, $6, $7)`,
		id, f.slotID, seats, "it-guest-"+id[len(id)-8:], token, HashManageToken(token), expiresAt)
	if err != nil {
		t.Fatalf("insert booking: %v", err)
	}
	return id, token
}

func guestIdentity(id string) contracts.AuthTicketPayload {
	return contracts.AuthTicketPayload{
		Messenger:   "telegram",
		MessengerID: "it-" + id,
		DisplayName: "Ann",
		Purpose:     "guest",
	}
}

func bookingData(f *fixture, seats int, options []string, guest contracts.AuthTicketPayload) CreateBookingData {
	return CreateBookingData{
		ServiceID:       f.serviceID,
		TimeSlotID:      f.slotID,
		Seats:           seats,
		GuestName:       "Ann",
		SelectedOptions: options,
		GuestLocale:     "en",
		Guest:           guest,
		TraceID:         "it-trace",
	}
}

// outboxRowsFor reads the outbox rows written for a booking.
func outboxRowsFor(t *testing.T, bookingID string) []OutboxRow {
	t.Helper()
	rows, err := Pool().Query(context.Background(), `
		SELECT id, queue, payload, coalesce(trace_id, ''), status::text, attempts
		FROM notification_outbox WHERE (payload::jsonb->>'bookingId') = $1`, bookingID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []OutboxRow{}
	for rows.Next() {
		var r OutboxRow
		if err := rows.Scan(&r.ID, &r.Queue, &r.Payload, &r.TraceID, &r.Status, &r.Attempts); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	return out
}

// ── CreateGuestBooking ───────────────────────────────────────────────────────

func TestCreateGuestBookingSuccess(t *testing.T) {
	f := newFixture(t, nil)
	ctx := context.Background()

	created, outbox, err := CreateGuestBooking(ctx, bookingData(f, 2, nil, guestIdentity("g1")))
	if err != nil {
		t.Fatal(err)
	}
	f.track(contracts.UUIDString(created.ID))

	if created.Status != gen.Confirmed || created.Seats != 2 {
		t.Fatalf("unexpected booking: %+v", created)
	}
	if created.ManageToken == "" {
		t.Fatal("the guest DTO must carry the manageToken (their management link)")
	}
	if got := f.bookedCount(t); got != 2 {
		t.Fatalf("booked_count = %d, want 2 (atomic reserve)", got)
	}

	// Outbox: one row per recipient (organizer + guest), both pending,
	// both carrying the booking id and the trace id (ADR-012).
	if len(outbox) != 2 {
		t.Fatalf("expected 2 outbox rows (fan-out per recipient), got %d", len(outbox))
	}
	recipients := map[string]bool{}
	for _, row := range outbox {
		if row.Queue != contracts.QueueBookingCreated {
			t.Errorf("outbox queue = %q, want %q", row.Queue, contracts.QueueBookingCreated)
		}
		if row.TraceID != "it-trace" {
			t.Errorf("outbox trace id = %q", row.TraceID)
		}
		var job struct {
			BookingID string `json:"bookingId"`
			Recipient string `json:"recipient"`
		}
		if err := json.Unmarshal([]byte(row.Payload), &job); err != nil {
			t.Fatalf("outbox payload: %v", err)
		}
		if job.BookingID != contracts.UUIDString(created.ID) {
			t.Errorf("outbox payload bookingId = %q, want %q", job.BookingID, contracts.UUIDString(created.ID))
		}
		recipients[job.Recipient] = true
	}
	if !recipients["organizer"] || !recipients["guest"] {
		t.Errorf("fan-out must cover organizer and guest, got %v", recipients)
	}

	// The rows are durable and pending in the DB (the caller publishes
	// after commit and marks them sent).
	stored := outboxRowsFor(t, contracts.UUIDString(created.ID))
	if len(stored) != 2 {
		t.Fatalf("outbox rows in DB = %d, want 2", len(stored))
	}
	for _, row := range stored {
		if row.Status != "pending" {
			t.Errorf("outbox row %s status = %q, want pending", row.ID, row.Status)
		}
	}
}

func TestCreateGuestBookingSoldOut(t *testing.T) {
	f := newFixture(t, func(s *slotSpec) { s.capacity = 3; s.booked = 3 })
	err := error(nil)
	_, _, err = CreateGuestBooking(context.Background(), bookingData(f, 1, nil, guestIdentity("g2")))
	var soldOut SlotSoldOutError
	if !errors.As(err, &soldOut) {
		t.Fatalf("full slot must be SlotSoldOutError, got %T: %v", err, err)
	}
	if soldOut.SeatsLeft != 0 {
		t.Errorf("SeatsLeft = %d, want 0", soldOut.SeatsLeft)
	}

	// Partial room: capacity 3, booked 2, party of 2 → 2+2 > 3, one seat left.
	f2 := newFixture(t, func(s *slotSpec) { s.capacity = 3; s.booked = 2 })
	_, _, err = CreateGuestBooking(context.Background(), bookingData(f2, 2, nil, guestIdentity("g3")))
	if !errors.As(err, &soldOut) {
		t.Fatalf("oversized party must be SlotSoldOutError, got %T: %v", err, err)
	}
	if soldOut.SeatsLeft != 1 {
		t.Errorf("SeatsLeft = %d, want 1", soldOut.SeatsLeft)
	}
}

func TestCreateGuestBookingPastSlot(t *testing.T) {
	f := newFixture(t, func(s *slotSpec) { s.startsAt = time.Now().Add(-2 * time.Hour) })
	_, _, err := CreateGuestBooking(context.Background(), bookingData(f, 1, nil, guestIdentity("g4")))
	var notBookable SlotNotBookableError
	if !errors.As(err, &notBookable) {
		t.Fatalf("past slot must be SlotNotBookableError, got %T: %v", err, err)
	}
	if got := f.bookedCount(t); got != 0 {
		t.Errorf("a refused booking must not claim seats, booked_count = %d", got)
	}
}

func TestCreateGuestBookingPartyTooLarge(t *testing.T) {
	f := newFixture(t, func(s *slotSpec) { s.maxSeats = 2 })
	_, _, err := CreateGuestBooking(context.Background(), bookingData(f, 3, nil, guestIdentity("g5")))
	var tooLarge PartyTooLargeError
	if !errors.As(err, &tooLarge) {
		t.Fatalf("oversized party must be PartyTooLargeError, got %T: %v", err, err)
	}
	if tooLarge.MaxSeats != 2 {
		t.Errorf("MaxSeats = %d, want 2", tooLarge.MaxSeats)
	}
	if got := f.bookedCount(t); got != 0 {
		t.Errorf("a refused booking must not claim seats, booked_count = %d", got)
	}
}

func TestCreateGuestBookingInvalidOptions(t *testing.T) {
	cases := []struct {
		name     string
		options  []string
		mode     string
		selected []string
	}{
		{"single with two selected", []string{"a", "b"}, "single", []string{"a", "b"}},
		{"unknown option", []string{"a", "b"}, "multi", []string{"nope"}},
		{"duplicate option", []string{"a", "b"}, "multi", []string{"a", "a"}},
		{"options on an optionless service", nil, "", []string{"a"}},
	}
	for _, c := range cases {
		f := newFixture(t, func(s *slotSpec) {
			s.options = c.options
			s.selectMode = c.mode
		})
		_, _, err := CreateGuestBooking(context.Background(), bookingData(f, 1, c.selected, guestIdentity("g6")))
		var invalid InvalidOptionSelectionError
		if !errors.As(err, &invalid) {
			t.Errorf("%s: must be InvalidOptionSelectionError, got %T: %v", c.name, err, err)
		}
	}
}

func TestCreateGuestBookingDuplicate(t *testing.T) {
	f := newFixture(t, nil)
	ctx := context.Background()
	guest := guestIdentity("g7")

	first, _, err := CreateGuestBooking(ctx, bookingData(f, 1, nil, guest))
	if err != nil {
		t.Fatal(err)
	}
	f.track(contracts.UUIDString(first.ID))

	// Same guest, same slot: the partial unique index rejects the second
	// INSERT with a 23505 → DuplicateBookingError, and the transaction
	// rolls back — releasing the seat the second attempt had claimed.
	_, _, err = CreateGuestBooking(ctx, bookingData(f, 2, nil, guest))
	var duplicate DuplicateBookingError
	if !errors.As(err, &duplicate) {
		t.Fatalf("duplicate must be DuplicateBookingError, got %T: %v", err, err)
	}
	if got := f.bookedCount(t); got != 1 {
		t.Fatalf("rollback must release the claimed seats: booked_count = %d, want 1", got)
	}

	// A different guest may still book the same slot.
	other, _, err := CreateGuestBooking(ctx, bookingData(f, 1, nil, guestIdentity("g8")))
	if err != nil {
		t.Fatalf("a different guest must be able to book: %v", err)
	}
	f.track(contracts.UUIDString(other.ID))
}

func TestCreateGuestBookingDemoRefused(t *testing.T) {
	requirePostgres(t)
	ctx := context.Background()

	// The demo organizer row (seeded by SeedDemo; insert defensively if
	// the local DB was never seeded — the guard only needs the chain).
	_, _ = Pool().Exec(ctx, `
		INSERT INTO organizers (id, slug, name, messenger, messenger_id, timezone, language)
		VALUES ($1::uuid, 'demo', 'Demo', 'telegram', 'demo', 'UTC', 'en')
		ON CONFLICT (id) DO NOTHING`, contracts.DemoOrganizerID)

	serviceID := newServiceID()
	slotID := newID()
	_, err := Pool().Exec(ctx, `
		INSERT INTO services (id, organizer_id, title, default_price, default_capacity, default_duration_minutes, max_seats_per_booking)
		VALUES ($1, $2::uuid, 'Demo Service', '0', 10, 60, 1)`, serviceID, contracts.DemoOrganizerID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = Pool().Exec(ctx, `
		INSERT INTO time_slots (id, service_id, starts_at, duration_minutes, capacity, booked_count)
		VALUES ($1::uuid, $2, $3, 60, 10, 0)`, slotID, serviceID, time.Now().Add(48*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = Pool().Exec(ctx, `DELETE FROM time_slots WHERE id = $1::uuid`, slotID)
		_, _ = Pool().Exec(ctx, `DELETE FROM services WHERE id = $1`, serviceID)
		// The demo organizer row itself is seed-owned (SeedDemo upserts
		// it; ON CONFLICT DO NOTHING above) — never deleted here.
	})

	_, _, err = CreateGuestBooking(ctx, CreateBookingData{
		ServiceID: serviceID, TimeSlotID: slotID, Seats: 1, GuestName: "Ann",
		GuestLocale: "en", Guest: guestIdentity("g9"), TraceID: "it-trace",
	})
	var readOnly demo.DemoReadOnlyError
	if !errors.As(err, &readOnly) {
		t.Fatalf("booking the demo organizer's slot must be refused, got %T: %v", err, err)
	}

	var booked int
	_ = Pool().QueryRow(ctx, `SELECT booked_count FROM time_slots WHERE id = $1::uuid`, slotID).Scan(&booked)
	if booked != 0 {
		t.Errorf("demo refusal must not claim seats, booked_count = %d", booked)
	}
}

// ── CancelGuestBookingByToken ─────────────────────────────────────────────────

func TestCancelGuestBookingByTokenSuccess(t *testing.T) {
	f := newFixture(t, func(s *slotSpec) { s.capacity = 5; s.booked = 2 })
	bookingID, token := f.insertBooking(t, 2, nil)

	cancelled, outbox, err := CancelGuestBookingByToken(context.Background(), token, "it-trace")
	if err != nil {
		t.Fatal(err)
	}
	if cancelled == nil {
		t.Fatal("cancel must return the booking")
	}
	if cancelled.Status != gen.Cancelled {
		t.Fatalf("status = %q, want cancelled", cancelled.Status)
	}
	if got := f.bookedCount(t); got != 0 {
		t.Fatalf("cancel must release the seats: booked_count = %d, want 0", got)
	}

	// One outbox row — the counterparty only (guest cancels → organizer
	// is notified), carrying cancelledBy=guest (ADR-012).
	if len(outbox) != 1 {
		t.Fatalf("expected 1 outbox row, got %d", len(outbox))
	}
	if outbox[0].Queue != contracts.QueueBookingCancelled {
		t.Errorf("queue = %q", outbox[0].Queue)
	}
	var job struct {
		BookingID   string `json:"bookingId"`
		CancelledBy string `json:"cancelledBy"`
	}
	if err := json.Unmarshal([]byte(outbox[0].Payload), &job); err != nil {
		t.Fatal(err)
	}
	if job.BookingID != bookingID || job.CancelledBy != "guest" {
		t.Errorf("outbox job = %+v, want bookingId=%s cancelledBy=guest", job, bookingID)
	}
}

func TestCancelGuestBookingIdempotent(t *testing.T) {
	f := newFixture(t, func(s *slotSpec) { s.capacity = 5; s.booked = 2 })
	_, token := f.insertBooking(t, 2, nil)

	if _, _, err := CancelGuestBookingByToken(context.Background(), token, "it-trace"); err != nil {
		t.Fatal(err)
	}
	afterFirst := f.bookedCount(t)

	// Double-tap: the status='confirmed' predicate updates no row —
	// reported as already cancelled, never a second decrement.
	_, _, err := CancelGuestBookingByToken(context.Background(), token, "it-trace")
	var already BookingAlreadyCancelledError
	if !errors.As(err, &already) {
		t.Fatalf("re-cancel must be BookingAlreadyCancelledError, got %T: %v", err, err)
	}
	if got := f.bookedCount(t); got != afterFirst {
		t.Fatalf("re-cancel must not double-decrement: booked_count = %d, want %d", got, afterFirst)
	}
}

func TestCancelGuestBookingUnknownToken(t *testing.T) {
	f := newFixture(t, nil)
	_, token := f.insertBooking(t, 1, nil)

	// Unknown token → (nil, nil): the caller answers 404 without
	// confirming whether the token exists.
	booking, _, err := CancelGuestBookingByToken(context.Background(), "no-such-token-aaaaaaaaaaaaaaaaaaaa", "it-trace")
	if err != nil || booking != nil {
		t.Fatalf("unknown token must be (nil, nil), got %v, %v", booking, err)
	}

	// Almost-right is still unknown: a single-char mutation of a real
	// token matches no hash.
	booking, _, err = CancelGuestBookingByToken(context.Background(), token+"x", "it-trace")
	if err != nil || booking != nil {
		t.Fatalf("a token that matches no hash must be (nil, nil), got %v, %v", booking, err)
	}

	// The SHA-256 hex itself is not a valid credential either: the lookup
	// key is HashManageToken(input), so presenting the stored hash only
	// matches if Hash(hash) == hash, which SHA-256 never yields here —
	// the raw token column is not a lookup key (ADR-020).
	booking, _, err = CancelGuestBookingByToken(context.Background(), HashManageToken(token), "it-trace")
	if err != nil || booking != nil {
		t.Fatalf("the stored hash presented as a token must be (nil, nil), got %v, %v", booking, err)
	}
}

func TestCancelGuestBookingExpiredToken(t *testing.T) {
	f := newFixture(t, func(s *slotSpec) { s.booked = 1 })
	expired := time.Now().Add(-time.Hour)
	_, token := f.insertBooking(t, 1, &expired)

	_, _, err := CancelGuestBookingByToken(context.Background(), token, "it-trace")
	var tokenExpired ManageTokenExpiredError
	if !errors.As(err, &tokenExpired) {
		t.Fatalf("expired manageToken must be ManageTokenExpiredError, got %T: %v", err, err)
	}
	if got := f.bookedCount(t); got != 1 {
		t.Errorf("an expired cancel must not release seats, booked_count = %d", got)
	}
}

// ── CancelOwnedBooking ────────────────────────────────────────────────────────

func TestCancelOwnedBookingSuccess(t *testing.T) {
	f := newFixture(t, func(s *slotSpec) { s.capacity = 5; s.booked = 3 })
	bookingID, _ := f.insertBooking(t, 3, nil)

	record, outbox, err := CancelOwnedBooking(context.Background(), f.organizerID, bookingID, "it-trace")
	if err != nil {
		t.Fatal(err)
	}
	if record == nil || record.Status != gen.Cancelled {
		t.Fatalf("unexpected record: %+v", record)
	}
	if got := f.bookedCount(t); got != 0 {
		t.Fatalf("cancel must release the seats: booked_count = %d, want 0", got)
	}

	// The guest is notified — one row, cancelledBy=organizer.
	if len(outbox) != 1 || outbox[0].Queue != contracts.QueueBookingCancelled {
		t.Fatalf("expected 1 booking.cancelled outbox row, got %+v", outbox)
	}
	var job struct {
		BookingID   string `json:"bookingId"`
		CancelledBy string `json:"cancelledBy"`
	}
	if err := json.Unmarshal([]byte(outbox[0].Payload), &job); err != nil {
		t.Fatal(err)
	}
	if job.BookingID != bookingID || job.CancelledBy != "organizer" {
		t.Errorf("outbox job = %+v, want bookingId=%s cancelledBy=organizer", job, bookingID)
	}
}

func TestCancelOwnedBookingForeignService(t *testing.T) {
	// A booking on someone else's service is answered exactly like an
	// unknown id — nil, not an error — so the endpoint cannot probe.
	mine := newFixture(t, nil)
	theirs := newFixture(t, func(s *slotSpec) { s.booked = 1 })
	bookingID, _ := theirs.insertBooking(t, 1, nil)

	record, _, err := CancelOwnedBooking(context.Background(), mine.organizerID, bookingID, "it-trace")
	if err != nil || record != nil {
		t.Fatalf("foreign booking must be (nil, nil), got %v, %v", record, err)
	}
	if got := theirs.bookedCount(t); got != 1 {
		t.Errorf("a foreign cancel must not release seats, booked_count = %d", got)
	}

	// Unknown booking id: same answer.
	record, _, err = CancelOwnedBooking(context.Background(), mine.organizerID, newID(), "it-trace")
	if err != nil || record != nil {
		t.Fatalf("unknown booking must be (nil, nil), got %v, %v", record, err)
	}
}

func TestCancelOwnedBookingDemoRefused(t *testing.T) {
	f := newFixture(t, func(s *slotSpec) { s.booked = 1 })
	bookingID, _ := f.insertBooking(t, 1, nil)

	_, _, err := CancelOwnedBooking(context.Background(), contracts.DemoOrganizerID, bookingID, "it-trace")
	var readOnly demo.DemoReadOnlyError
	if !errors.As(err, &readOnly) {
		t.Fatalf("demo organizer must be refused, got %T: %v", err, err)
	}
	if got := f.bookedCount(t); got != 1 {
		t.Errorf("demo refusal must not release seats, booked_count = %d", got)
	}
}

// ── Atomic reserve under contention (invariant 2) ────────────────────────────

func TestCreateGuestBookingConcurrentLastSeats(t *testing.T) {
	// Ten guests race for five seats. Postgres evaluates the conditional
	// UPDATE's predicate against the row it locks, so exactly five must
	// win and booked_count must end at capacity — never above. A
	// read-check-write implementation would overbook here.
	f := newFixture(t, func(s *slotSpec) { s.capacity = 5; s.booked = 0 })
	ctx := context.Background()

	const racers = 10
	var won atomic.Int64
	var soldOut atomic.Int64
	var failed atomic.Int64
	// Booking ids are collected over a channel and tracked serially after
	// the race — f.track appends to a slice and is not goroutine-safe.
	wonIDs := make(chan string, racers)
	var wg sync.WaitGroup
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			// Unique guest per racer: the partial unique index must never
			// interfere — only the seat predicate decides who wins.
			created, _, err := CreateGuestBooking(ctx, bookingData(f, 1, nil,
				guestIdentity(fmt.Sprintf("race-%d", i))))
			if err == nil {
				won.Add(1)
				wonIDs <- contracts.UUIDString(created.ID)
				return
			}
			var so SlotSoldOutError
			if errors.As(err, &so) {
				soldOut.Add(1)
				return
			}
			failed.Add(1)
			t.Errorf("racer %d: unexpected error %T: %v", i, err, err)
		}(i)
	}
	wg.Wait()
	close(wonIDs)
	for id := range wonIDs {
		f.track(id)
	}

	if failed.Load() != 0 {
		t.Fatalf("racers hit %d unexpected errors", failed.Load())
	}
	if got := f.bookedCount(t); got != 5 {
		t.Fatalf("booked_count = %d, want exactly capacity 5 (no overbooking)", got)
	}
	// Winners hold seats; losers were told sold out. booked_count is the
	// source of truth — the win/lose split must be consistent with it.
	if won.Load() != 5 {
		t.Fatalf("won = %d, want exactly capacity 5", won.Load())
	}
	if won.Load()+soldOut.Load() != racers {
		t.Fatalf("won (%d) + soldOut (%d) must cover all %d racers", won.Load(), soldOut.Load(), racers)
	}
}
